import type { Expr } from "./types";

/** 表达式构造小工具，让定义保持可读。 */
export const st = (key: string): Expr => ({ ref: `state.${key}` });
export const param: Expr = { ref: "param" };
export const eq = (a: Expr, b: Expr): Expr => ({ op: "eq", args: [a, b] });
export const ne = (a: Expr, b: Expr): Expr => ({ op: "ne", args: [a, b] });
export const and = (...a: Expr[]): Expr => ({ op: "and", args: a });
export const or = (...a: Expr[]): Expr => ({ op: "or", args: a });
export const not = (a: Expr): Expr => ({ op: "not", args: [a] });
