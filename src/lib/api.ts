/** JSON response with open CORS so other tools (and Wader) can call the API from anywhere. */
export function json(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, {
    ...init,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=15, s-maxage=15",
      ...init.headers,
    },
  });
}

export const ATTRIBUTION = "Data provided by Airframes.io and its community of feeders. Not for operational use.";
