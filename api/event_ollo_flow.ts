/* -------- analyze -------- */
if (step === "analyze") {
  const analysis = await analyzeExisting(field, existingValue);

  if (analysis.needs_clarification && analysis.clarifying_question) {
    return res.json({
      ok: true,
      ui: [{ role: "assistant", text: analysis.clarifying_question }],
      next_step: "ask_clarifying",
      state: { ...state, must_include: mustInclude }, // <–– Fix för att bevara must_include
    });
  }

  const proposal = await proposeImproved(field, existingValue, undefined, mustInclude);

  return res.json({
    ok: true,
    ui: [
      { role: "assistant", text: `Här är ett förbättrat förslag:\n\n${proposal}` },
      { role: "assistant", buttons: [
        { text: "Justera", action: "refine" },
        { text: "Spara", action: "finalize" },
      ] },
    ],
    next_step: "refine",
    state: { ...state, last_proposal: proposal },
  });
}
