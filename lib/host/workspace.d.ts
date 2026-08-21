declare const WALK_SKIP_DIRS: Set<string>;
declare function walkWorkspaceFiles(cwd: string, options?: {
    maxFiles?: number;
    maxDepth?: number;
}): Promise<Array<{
    name: string;
    path: string;
    rel: string;
    kind: string;
    size: number;
}>>;
export { WALK_SKIP_DIRS, walkWorkspaceFiles };
