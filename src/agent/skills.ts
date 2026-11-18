import type { TrueForge, TrueForgeApi } from "@truefoundry/trueforge-sdk";

/** Explicit administrative setup. Never publishes source or silently registers third-party skills. */
export async function registerFinnReviewSkill(
  client: TrueForge,
  source: { url: string; ref: string; name?: string },
): Promise<string> {
  const manifest: TrueForgeApi.GitSkill = {
    name: source.name ?? "finn-review-first",
    type: "git",
    description:
      "Review-first coding in Finn: budgeted repository context, test-first changes, human-reviewed source proposals and explicitly approved verification commands.",
    url: source.url,
    ref: source.ref,
    path: "src/agent/skills/review-first",
  };
  await client.settings.skills.createOrUpdate(
    { manifest },
    { maxRetries: 0, timeoutInSeconds: 30 },
  );
  const readback = await client.settings.skills.list({
    maxRetries: 0,
    timeoutInSeconds: 30,
  });
  const registered = readback.data.find(
    (skill) => skill.name === manifest.name,
  )?.manifest;
  if (
    registered?.type !== "git" ||
    registered.url !== manifest.url ||
    registered.ref !== manifest.ref ||
    registered.path !== manifest.path
  ) {
    throw new Error(
      "TrueForge native review skill registration could not be verified",
    );
  }
  return manifest.name;
}
