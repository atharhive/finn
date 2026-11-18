export interface Snapshot { repo: string; commit: string; status: string; files: Record<string, string> }
export const DEBUG_CASES: Record<string, boolean>;
export function validateDebugFlags(observations: Record<string, boolean>): true;
export function validateMaskedConfig(output: string): Record<string, unknown>;
export function validateHelp(output: string): true;
export function validateTaskBFiles(files: string[]): true;
export function validateCleanSnapshot(before: Snapshot, after: Snapshot): true;
export function changedFiles(before: Record<string, string>, after: Record<string, string>): string[];
export function snapshot(repo: string): Snapshot;
export function validateOutputPath(output: string, workspaces: string[]): string;
export function main(args?: string[]): unknown;
