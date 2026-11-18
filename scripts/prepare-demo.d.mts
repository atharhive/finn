export const FLASK_TAG: string;
export const FLASK_PREFIX: string;
export const FLASK_URL: string;
export function validateRevision(revision: string): string;
export function parseArgs(args: string[], schema: Record<string, 'boolean' | 'value'>): Record<string, any>;
export function run(command: string, args: string[], options?: { quiet?: boolean; cwd?: string; env?: Record<string, string>; timeout?: number }): string;
export function pythonInstallCommand(python: string, repo: string, hasUv: boolean): [string, string[]];
export function main(args?: string[]): void;
