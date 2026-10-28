"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ProfileScreen } from "@/components/onboarding/ProfileScreen";
import { TeamSelectScreen } from "@/components/onboarding/TeamSelectScreen";
import syntheticMatchFrames from "@/mocks/match_900001_frames.json";
import { DEFAULT_MATCH_ID, getMatchInfo } from "@/lib/match";
import {
  FanIdentity,
  generateUserId,
  readChosenTeam,
  readFanIdentity,
  writeChosenTeam,
  writeFanIdentity,
} from "@/lib/fan";
import type { MatchFramePayload, MatchInfo, TeamInfo, TeamSide } from "@/types/match";

// Team names / colours come from the bundled synthetic match so these screens work without
// the backend (same file the backend generates, see useMatchEngine.ts).
const MATCH_INFO: MatchInfo = getMatchInfo((syntheticMatchFrames as MatchFramePayload[])[0]);

interface FanSession {
  matchId: number;
  identity: FanIdentity;
  team: TeamSide;
  teamInfo: TeamInfo;
  /** Back to the team-selection screen (from there the profile can be edited too). */
  openTeamSelection: () => void;
}

const FanSessionContext = createContext<FanSession | null>(null);

/** Fan identity and team inside the dashboard; null outside the gate. */
export function useFanSession(): FanSession | null {
  return useContext(FanSessionContext);
}

type Step = "loading" | "profile" | "team" | "dashboard";

/**
 * Pre-match flow: Profile (first visit only) → Team selection → children (the dashboard).
 * Identity is stored under `xt-whatif.fan`, the team per match under `xt-whatif.team.<matchId>`;
 * language and audience stay in the i18n profile (`xt-whatif.profile`).
 */
export const OnboardingGate: React.FC<{ matchId?: number; children: React.ReactNode }> = ({
  matchId = DEFAULT_MATCH_ID,
  children,
}) => {
  const [step, setStep] = useState<Step>("loading");
  const [identity, setIdentity] = useState<FanIdentity | null>(null);
  const [team, setTeam] = useState<TeamSide | null>(null);
  // Whether the dashboard has been reached in this session (labels "Back to match").
  const [hasStarted, setHasStarted] = useState(false);

  // Storage is only read on the client, after the first render, to avoid hydration mismatches.
  useEffect(() => {
    const storedIdentity = readFanIdentity();
    const storedTeam = readChosenTeam(matchId);
    setIdentity(storedIdentity);
    setTeam(storedTeam);
    if (!storedIdentity) setStep("profile");
    else if (!storedTeam) setStep("team");
    else {
      setHasStarted(true);
      setStep("dashboard");
    }
  }, [matchId]);

  const session = useMemo<FanSession | null>(
    () =>
      identity && team
        ? {
            matchId,
            identity,
            team,
            teamInfo: MATCH_INFO[team],
            openTeamSelection: () => setStep("team"),
          }
        : null,
    [identity, team, matchId]
  );

  if (step === "loading") {
    return <div className="min-h-screen bg-ink" aria-busy="true" suppressHydrationWarning />;
  }

  if (step === "profile") {
    return (
      <ProfileScreen
        key="profile"
        initialNickname={identity?.nickname ?? ""}
        onCancel={identity ? () => setStep("team") : undefined}
        onSubmit={(nickname) => {
          const next: FanIdentity = { userId: identity?.userId ?? generateUserId(), nickname };
          writeFanIdentity(next);
          setIdentity(next);
          setStep("team");
        }}
      />
    );
  }

  if (step === "team" || !session) {
    return (
      <TeamSelectScreen
        key="team"
        matchId={matchId}
        matchInfo={MATCH_INFO}
        nickname={identity?.nickname ?? ""}
        initialTeam={team}
        isReturning={hasStarted}
        onEditProfile={() => setStep("profile")}
        onConfirm={(side) => {
          writeChosenTeam(matchId, side);
          setTeam(side);
          setHasStarted(true);
          setStep("dashboard");
        }}
      />
    );
  }

  return <FanSessionContext.Provider value={session}>{children}</FanSessionContext.Provider>;
};

export default OnboardingGate;
