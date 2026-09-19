export function alreadyPostedResponse(url: string | null | undefined): string {
  return `already posted: ${displayUrl(url)}`;
}

export function postedResponse(title: string, url: string | null): string {
  return `posted: ${title} · ${displayUrl(url)}`;
}

function displayUrl(url: string | null | undefined): string {
  if (url === null || url === undefined || url === "") {
    return "Strava activity";
  }
  return url.replace(/^https:\/\/(?:www\.)?/, "");
}
