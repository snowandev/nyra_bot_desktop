import { describe, expect, it } from "vitest";
import { buildUserRules, withoutPersonalData } from "./userRules";

const personalization = { name: "Marta", occupation: "Diseñadora gráfica", instructions: "Responde breve." };

describe("withoutPersonalData", () => {
  it("leaves out who the user is and keeps how to reply, for a private conversation", () => {
    const rules = buildUserRules(withoutPersonalData(personalization));
    const sent = `${rules?.system}\n${rules?.reminder}`;
    expect(sent).not.toContain("Marta");
    expect(sent).not.toContain("Diseñadora");
    expect(sent).toContain("Responde breve.");
  });

  it("sends nothing when only the name and occupation were set", () => {
    expect(buildUserRules(withoutPersonalData({ ...personalization, instructions: "" }))).toBeNull();
  });
});
