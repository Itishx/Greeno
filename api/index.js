// The Vercel entry point. An Express app exported as a serverless function.
//
// There is no store on disk here: the browser sends its document with each
// request and gets the mutated one back. See the comment at the top of
// server/app.cjs for why that was the cheapest correct answer.
module.exports = require("../server/app.cjs");
