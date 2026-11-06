// A POST of the body as JSON, with lib.sh's tries; the status is logged, the response is not.
const { url, body = {} } = squidci.input;
const TRIES = 4;
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
const pause = (attempt) => new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));

for (let attempt = 1; ; attempt += 1) {
  let status;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });

    await response.body?.cancel();
    status = response.status;
  } catch (error) {
    if (attempt < TRIES) {
      console.log(`squidci: ${url} could not be reached (${error?.message ?? error}); trying again`);
      await pause(attempt);
      continue;
    }

    throw new Error(`the webhook to ${url} could not be sent: ${error?.message ?? error}`);
  }

  console.log(`squidci: ${url} answered ${status}`);

  if (status >= 200 && status < 300) {
    break;
  }

  if (TRANSIENT.has(status) && attempt < TRIES) {
    await pause(attempt);
    continue;
  }

  throw new Error(`the webhook to ${url} answered ${status}, not a success`);
}
