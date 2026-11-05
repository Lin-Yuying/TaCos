"use client";

import { useEffect, useState } from "react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { getCollabSessionAction } from "@/app/pages-actions";

// A socket that cannot connect should not hold up writing: past this, the page saves the old way.
const CONNECT_WITHIN_MS = 5000;

export type CollabPeer = { clientId: number; name: string; color: string };

export type DocCollab =
  | { status: "connecting" | "off" }
  | {
      status: "live" | "reconnecting";
      doc: Y.Doc;
      provider: HocuspocusProvider;
      user: { name: string; color: string };
      peers: CollabPeer[];
    };

// The socket's port is the page's port plus one, on a server and through the SSH tunnel alike.
function socketUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.hostname}:${Number(window.location.port || 80) + 1}`;
}

export function useDocCollab(workspaceId: string, pageId: string): DocCollab {
  const [state, setState] = useState<DocCollab>({ status: "connecting" });

  useEffect(() => {
    let closed = false;
    let provider: HocuspocusProvider | null = null;
    let waiting: ReturnType<typeof setTimeout> | null = null;

    void getCollabSessionAction(workspaceId, pageId)
      .catch(() => null)
      .then((result) => {
        if (closed) return;
        if (!result?.ok || !result.data) return setState({ status: "off" });
        const { token, user } = result.data;
        const doc = new Y.Doc();
        const current = new HocuspocusProvider({
          url: socketUrl(),
          name: pageId,
          document: doc,
          token: async () => {
            const next = await getCollabSessionAction(workspaceId, pageId);
            return next.ok && next.data ? next.data.token : token;
          },
        });
        provider = current;
        let synced = false;
        let connected = true;

        const peers = (): CollabPeer[] =>
          [...(current.awareness?.getStates().entries() ?? [])].flatMap(([clientId, value]) => {
            const peer = (value as { user?: { name?: string; color?: string } }).user;
            return clientId !== current.awareness?.clientID && peer?.name
              ? [{ clientId, name: peer.name, color: peer.color ?? "#888" }]
              : [];
          });
        const show = (status: "live" | "reconnecting") =>
          setState({ status, doc, provider: current, user, peers: peers() });

        waiting = setTimeout(() => {
          if (synced) return;
          current.destroy();
          doc.destroy();
          provider = null;
          setState({ status: "off" });
        }, CONNECT_WITHIN_MS);

        current.on("synced", () => {
          synced = true;
          if (waiting) clearTimeout(waiting);
          show("live");
        });
        current.on("status", ({ status }: { status: string }) => {
          connected = status === "connected";
          if (synced) show(connected ? "live" : "reconnecting");
        });
        current.on("awarenessChange", () => {
          if (synced) show(connected ? "live" : "reconnecting");
        });
      });

    return () => {
      closed = true;
      if (waiting) clearTimeout(waiting);
      provider?.destroy();
    };
  }, [workspaceId, pageId]);

  return state;
}
