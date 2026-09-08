// Double-Option, globally. A helper process, not a library, because a listen-only
// CGEventTap needs Accessibility and a run loop, and neither belongs inside the
// Electron main process.
//
// It prints one line per gesture on stdout and Electron reads them. Ported in
// shape from mac/braino-mac/native/BrainoControlTap.swift, trimmed to the two
// gestures the companion actually uses.
//
// A "tap" is a modifier pressed and released inside TAP_MS with no other key or
// click in between. Two taps inside GAP_MS is the gesture. The poison flag is the
// whole trick: any real keystroke or click while the modifier is held means the
// user was doing something else, so the tap does not count.

import ApplicationServices
import Cocoa
import Foundation

let TAP_MS = 0.30
let GAP_MS = 0.40

final class Tap {
  private var tap: CFMachPort?
  private var optionDown = false, optionPoisoned = false
  private var lastOptionDownAt: TimeInterval = 0, lastOptionTap: TimeInterval = 0
  private var controlDown = false, controlPoisoned = false
  private var lastControlDownAt: TimeInterval = 0, lastControlTap: TimeInterval = 0

  func start() {
    prompt()
    emit("ready")
    tryStart()
    Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
      guard let self, self.tap == nil else { return }
      self.tryStart()
    }
    RunLoop.main.run()
  }

  private func emit(_ s: String) { print(s); fflush(stdout) }

  private func prompt() {
    let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    if !AXIsProcessTrustedWithOptions([key: true] as CFDictionary) { emit("needs-accessibility") }
  }

  private func tryStart() {
    guard AXIsProcessTrusted() else { prompt(); return }
    let types: [CGEventType] = [.flagsChanged, .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown]
    var mask: CGEventMask = 0
    for t in types { mask |= CGEventMask(1) << CGEventMask(t.rawValue) }
    let me = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
    guard let t = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                                    options: .listenOnly, eventsOfInterest: mask,
                                    callback: handler, userInfo: me) else { return }
    tap = t
    let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, t, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), src, .commonModes)
    CGEvent.tapEnable(tap: t, enable: true)
    emit("tap-live")
  }

  fileprivate func handle(_ type: CGEventType, _ event: CGEvent) {
    let now = ProcessInfo.processInfo.systemUptime

    // Any real key or click while a modifier is held means they meant something
    // else by it. Poison the pending tap rather than firing on a chord.
    if type == .keyDown || type == .leftMouseDown || type == .rightMouseDown || type == .otherMouseDown {
      if optionDown { optionPoisoned = true }
      if controlDown { controlPoisoned = true }
      return
    }
    guard type == .flagsChanged else { return }

    let flags = event.flags
    step(isDown: flags.contains(.maskAlternate), other: flags.contains(.maskCommand) || flags.contains(.maskControl) || flags.contains(.maskShift),
         now: now, down: &optionDown, poisoned: &optionPoisoned, downAt: &lastOptionDownAt, lastTap: &lastOptionTap, name: "option")
    step(isDown: flags.contains(.maskControl), other: flags.contains(.maskCommand) || flags.contains(.maskAlternate) || flags.contains(.maskShift),
         now: now, down: &controlDown, poisoned: &controlPoisoned, downAt: &lastControlDownAt, lastTap: &lastControlTap, name: "control")
  }

  private func step(isDown: Bool, other: Bool, now: TimeInterval, down: inout Bool, poisoned: inout Bool,
                    downAt: inout TimeInterval, lastTap: inout TimeInterval, name: String) {
    if isDown && !down {
      down = true; poisoned = other; downAt = now
    } else if !isDown && down {
      down = false
      let quick = now - downAt < TAP_MS
      let clean = !poisoned
      poisoned = false
      guard quick && clean else { lastTap = 0; return }
      if now - lastTap < GAP_MS { lastTap = 0; emit("double-\(name)") }
      else { lastTap = now }
    }
  }
}

private func handler(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent,
                     refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
  if let refcon {
    Unmanaged<Tap>.fromOpaque(refcon).takeUnretainedValue().handle(type, event)
  }
  return Unmanaged.passUnretained(event)
}

Tap().start()
