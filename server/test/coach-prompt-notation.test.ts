import { describe, expect, it } from "vitest";
import { explainMovePrompt } from "../src/coach/facts.js";
import { systemPrompt } from "../src/coach/locales.js";
import type { Language } from "../src/types.js";

// The Scholar's-mate blunder used by every coach regression test.
const SCHOLAR = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3";
const INPUT = {
  fen: SCHOLAR,
  player: "Black" as const,
  played_san: "Nf6",
  best_san: "g6",
  classification: "blunder" as const,
  cp_loss: 9000,
};

const LANGUAGES: Language[] = ["en", "bg", "es", "de", "ru", "pt"];

/** FACTS is the JSON block at the head of the user message. */
function factsOf(prompt: string): Record<string, any> {
  const start = prompt.indexOf("{");
  const end = prompt.indexOf("\n\nTASK");
  return JSON.parse(prompt.slice(start, end));
}

describe("coach prompt — moves are written in notation", () => {
  it("hands the model both spellings of the played and the better move", () => {
    for (const language of LANGUAGES) {
      const facts = factsOf(explainMovePrompt(INPUT, language, "intermediate"));
      expect(facts.played.san).toBe("Nf6");
      // The natural phrasing stays: the fallback answer and the TTS use it.
      expect(facts.played.natural).toContain("g8");
      expect(facts.played.natural).toContain("f6");
      expect(facts.best.san).toBe("g6");
    }
  });

  it("allows notation in the system rules instead of banning it", () => {
    // The ban existed because models invented moves; the fix is to copy the
    // SAN fields verbatim, the same way pieces and squares already work.
    for (const language of LANGUAGES) {
      const rules = systemPrompt("beginner", language);
      expect(rules).toContain("Nf3");
      expect(rules).not.toMatch(/Never write chess notation/);
    }
  });

  it("asks for a short answer in every language", () => {
    for (const language of LANGUAGES) {
      const prompt = explainMovePrompt(INPUT, language, "intermediate");
      expect(prompt).toContain("~50");
      expect(prompt).toContain("better_move_san");
      // Step 1 quotes the label, not the textbook definition of the verdict.
      expect(prompt).toContain("FACTS.verdict_short");
    }
  });

  it("gives Portuguese its own task instead of the English one", () => {
    const pt = explainMovePrompt(INPUT, "pt", "beginner");
    expect(pt).toContain("Treine o jogador neste lance");
    expect(pt).toContain("notação algébrica");
    expect(pt).not.toContain("Coach the player on this move");
    expect(systemPrompt("beginner", "pt")).toContain("notação algébrica");
  });
});
