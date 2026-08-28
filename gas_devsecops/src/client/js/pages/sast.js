// Code — a configuration, not an implementation.
//
// The page is register.js and the claims are registerModel.js. This file names which of the
// three this route is, and nothing else: three copies of a register would drift, and the
// honesty rules are exactly the part that must not.

import { renderRegister } from "./register.js";
import { REGISTERS } from "./registerModel.js";

export function renderSast(host) {
  renderRegister(host, REGISTERS.sast);
}
