import { useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";

interface OAuthCallbackPanelProps {
  /** The full hash route, e.g. "/oauth-callback?token=..." or "...?error=...". */
  route: string;
}

/**
 * Landing spot for @maker/accounts' OAuth redirect (`.../#/oauth-callback?token=...`)
 * - adopts the token into the shared session and sends the browser on to the
 * editor, or shows what went wrong if the provider/accounts service
 * reported an error instead of a token.
 */
export function OAuthCallbackPanel({ route }: OAuthCallbackPanelProps) {
  const { completeOAuthLogin } = useAuth();
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(route.split("?")[1] ?? "");
    const token = params.get("token");
    if (token) {
      void completeOAuthLogin(token).then(() => {
        window.location.hash = "#/editor";
      });
      return;
    }
    setFailure(params.get("error") ?? "OAuth sign-in did not return a token");
  }, [route, completeOAuthLogin]);

  if (failure) {
    return (
      <div className="oauth-callback">
        <p role="alert" className="oauth-callback__error">
          Sign-in failed: {failure}
        </p>
        <a href="#/editor">Back to the editor</a>
      </div>
    );
  }

  return <p className="oauth-callback__pending">Signing you in…</p>;
}
