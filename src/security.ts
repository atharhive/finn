/** Shared secret and VCS names. Context inventory, MCP tools and inline selection must agree. */
export function isDeniedName(name: string): boolean {
  return /^(?:\.git|\.hg|\.svn|\.env(?:rc|\..*)?|\.ssh|\.docker|\.aws|\.azure|\.kube|\.gnupg|node_modules|target|dist|build|coverage|\.next|\.npmrc|\.netrc|\.pypirc|api[-_]key(?:\..*)?|service[-_]account(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?)$/i.test(name)
    || /\.(?:pem|key|p12|pfx|keystore)$/i.test(name);
}

export function isHardlink(stat: { nlink: number; isFile(): boolean }): boolean {
  return stat.isFile() && stat.nlink > 1;
}
