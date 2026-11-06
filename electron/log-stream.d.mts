import type { Writable } from "node:stream";
export function createLogStream(file:string):Writable;
export function maintainLogs(dir:string):Promise<void>;
