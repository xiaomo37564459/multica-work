import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { RosterEntry } from "@contract";
import { createMockApi } from "../mock/api.ts";
import { createLiveApi } from "../api/live.ts";
import { DispatchModal } from "../components/DispatchModal.tsx";
import { ShoutModal } from "../components/ShoutModal.tsx";
import { RosterScreen } from "../screens/RosterScreen.tsx";
import { AgentScreen } from "../screens/AgentScreen.tsx";
import { CampaignScreen } from "../screens/CampaignScreen.tsx";

const T0 = 1_757_000_000_000;

async function rosterOf(api: Parameters<typeof createMockApi>[0] extends never ? never: ReturnType<typeof createMockApi>) {
  const env = await api.roster();
  if (!env.ok) throw new Error("roster missing");
  return env.data;
}

describe("dispatch modal", () => {
  it("blocks submit without title/agent", async () => {
    const api = createMockApi({ latencyMs: 0, now: () => T0 });
    const world = (await api.roster());
    void world;
    render(<DispatchModal entries={[]} projects={[]} dispatch={vi.fn()} onClose={() => {}} onDone={() => {}} />);
    expect((screen.getByRole("button", { name: /下一步/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
