export function parseGithubRepoText(
  text: string,
): { owner: string; repo: string } | null {
  const trimmed = text.trim();
  const urlMatch = trimmed.match(
    /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s.]+?)(?:\.git)?\/?$/i,
  );
  if (urlMatch?.[1] && urlMatch[2]) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }
  const slugMatch = trimmed.match(
    /^([^/\s]+)\/([^/\s.]+?)(?:\.git)?\/?$/,
  );
  if (slugMatch?.[1] && slugMatch[2]) {
    return { owner: slugMatch[1], repo: slugMatch[2] };
  }
  return null;
}
