/**
 * Client-side SD-JWT helpers.
 *
 * The verifier portal uses this to show the citizen exactly what a presentation
 * contains BEFORE it is sent anywhere. Note this is a *preview only* — it trusts
 * nothing. The real verification happens on the server, where the signature and
 * the consent record are checked.
 */

/** base64url -> utf8 string, in the browser. */
function base64urlToUtf8(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const withPadding = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(withPadding);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export interface PresentedDisclosure {
  key: string;
  value: unknown;
}

export interface DecodedPresentation {
  /** The signed JWT header (contains only the algorithm, no secrets). */
  header: Record<string, unknown> | null;
  /** The signed payload: DIDs, timestamps, and `_sd` digests — no claim values. */
  payload: Record<string, unknown> | null;
  disclosures: PresentedDisclosure[];
  /** Claims the citizen did NOT pick — visible nowhere in this presentation. */
  digestCount: number;
}

/** Split and decode `<jwt>~<disclosure>~...` for display purposes. */
export function decodePresentation(presentation: string): DecodedPresentation | null {
  const parts = presentation.split('~').filter(Boolean);
  if (parts.length === 0) return null;

  const jwt = parts[0];
  const segments = jwt.split('.');
  if (segments.length !== 3) return null;

  let header: Record<string, unknown> | null = null;
  let payload: Record<string, unknown> | null = null;
  try {
    header = JSON.parse(base64urlToUtf8(segments[0])) as Record<string, unknown>;
    payload = JSON.parse(base64urlToUtf8(segments[1])) as Record<string, unknown>;
  } catch {
    return null;
  }

  const disclosures: PresentedDisclosure[] = [];
  for (const disclosure of parts.slice(1)) {
    const dot = disclosure.indexOf('.');
    if (dot < 0) continue;
    try {
      const body = JSON.parse(base64urlToUtf8(disclosure.slice(dot + 1))) as Record<string, unknown>;
      const keys = Object.keys(body).filter((k) => k !== 'sd');
      if (keys.length === 1) {
        disclosures.push({ key: keys[0], value: body[keys[0]] });
      }
    } catch {
      /* skip unreadable disclosure */
    }
  }

  return {
    header,
    payload,
    disclosures,
    digestCount: Array.isArray(payload?._sd) ? (payload._sd as string[]).length : 0,
  };
}
