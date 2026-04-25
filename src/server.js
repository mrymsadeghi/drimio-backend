const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const dotenv = require("dotenv");
const { callOpenAIJSON } = require("./ai");
const { requireAuth } = require("./auth");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8080);
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
const titleModel = process.env.OPENAI_MODEL_TITLE || "gpt-4.1-mini";
const analyzeModel = process.env.OPENAI_MODEL_ANALYZE || "gpt-4.1";
const interpretModel = process.env.OPENAI_MODEL_INTERPRET || "gpt-4.1";
const updateSoulModel = process.env.OPENAI_MODEL_UPDATE_SOUL || "gpt-4.1";
const defaultModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: allowedOrigin === "*" ? true : allowedOrigin }));
app.use(express.json({ limit: "1mb" }));

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.GLOBAL_RATE_LIMIT_PER_MIN || 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." }
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.AI_RATE_LIMIT_PER_MIN || 20),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: { error: "Too many requests. Please slow down." }
});

app.use(globalLimiter);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "dreamio-backend" });
});

app.use("/v1/", requireAuth, aiLimiter);

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid field: ${fieldName}`);
  }
  return value.trim();
}

function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function handleRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(400).json({ error: message });
    }
  };
}

app.post(
  "/v1/dreams/title",
  handleRoute(async (req, res) => {
    const dream = requireString(req.body?.dream, "dream");

    const result = await callOpenAIJSON({
      model: titleModel,
      systemPrompt:
        "You create short, evocative dream titles. Return strictly JSON: {\"title\":\"...\"}.",
      userPrompt: `Dream:\n${dream}\n\nReturn one concise title (max 8 words).`
    });

    const title = requireString(result?.title, "title");
    res.json({ title });
  })
);

app.post(
  "/v1/dreams/analyze",
  handleRoute(async (req, res) => {
    const dream = requireString(req.body?.dream, "dream");
    const userName = requireString(req.body?.user_name, "user_name");

    const result = await callOpenAIJSON({
      model: analyzeModel,
      systemPrompt:
        "You are a reflective dream guide. Return strictly JSON with keys: output, Q1, Q2, Q3, optionally Q4 and Q5.",
      userPrompt: `User name: ${userName}\nDream:\n${dream}\n\nWrite a short supportive reflection and 3-5 follow-up questions.`
    });

    const payload = {
      output: requireString(result?.output, "output"),
      Q1: requireString(result?.Q1, "Q1"),
      Q2: requireString(result?.Q2, "Q2"),
      Q3: requireString(result?.Q3, "Q3")
    };

    if (typeof result?.Q4 === "string" && result.Q4.trim()) payload.Q4 = result.Q4.trim();
    if (typeof result?.Q5 === "string" && result.Q5.trim()) payload.Q5 = result.Q5.trim();

    res.json(payload);
  })
);

app.post(
  "/v1/dreams/distill",
  handleRoute(async (req, res) => {
    const dream = requireString(req.body?.dream, "dream");
    const conversations = Array.isArray(req.body?.conversations) ? req.body.conversations : [];

    if (!conversations.length) {
      throw new Error("Invalid field: conversations");
    }

    const normalizedConversations = conversations.map((pair, index) => ({
      question: requireString(pair?.question, `conversations[${index}].question`),
      answer: requireString(pair?.answer, `conversations[${index}].answer`)
    }));

    const result = await callOpenAIJSON({
      model: defaultModel,
      systemPrompt:
        "You summarize user dream Q&A into one concise distilled insight. Return strictly JSON: {\"text\":\"...\"}.",
      userPrompt: `Dream:\n${dream}\n\nQ&A:\n${JSON.stringify(normalizedConversations, null, 2)}`
    });

    const text = requireString(result?.text, "text");
    res.json({ response: { text } });
  })
);

app.post(
  "/v1/dreams/interpret",
  handleRoute(async (req, res) => {
    const dreamContent = requireString(req.body?.dream_content, "dream_content");
    const userPersonalInfo = optionalString(req.body?.user_personal_info);
    const userRecurringDreams = optionalString(req.body?.user_recurring_dreams);
    const userDistilledInfo = optionalString(req.body?.user_distilled_info);
    const qaPairs = Array.isArray(req.body?.qa_pairs) ? req.body.qa_pairs : [];

    const normalizedPairs = qaPairs.map((pair, index) => ({
      question: requireString(pair?.question, `qa_pairs[${index}].question`),
      answer: requireString(pair?.answer, `qa_pairs[${index}].answer`)
    }));

    const result = await callOpenAIJSON({
      model: interpretModel,
      systemPrompt:
        "You generate a structured dream interpretation. Return strictly JSON with keys: summary, keyThemes (array), interpretation, reflectionPrompt.",
      userPrompt: `Dream content:\n${dreamContent}

User personal info:\n${userPersonalInfo || "(none provided)"}

Recurring dreams:\n${userRecurringDreams || "(none provided)"}

User distilled info:\n${userDistilledInfo || "(none provided)"}

QA pairs:\n${JSON.stringify(normalizedPairs, null, 2)}`
    });

    const summary = requireString(result?.summary, "summary");
    const interpretation = requireString(result?.interpretation, "interpretation");
    const reflectionPrompt = requireString(result?.reflectionPrompt, "reflectionPrompt");

    const keyThemes = Array.isArray(result?.keyThemes)
      ? result.keyThemes.map((item) => String(item).trim()).filter(Boolean)
      : [];

    if (!keyThemes.length) {
      throw new Error("Invalid field: keyThemes");
    }

    res.json({
      summary,
      keyThemes,
      interpretation,
      reflectionPrompt
    });
  })
);

app.post(
  "/v1/dreams/update-soul",
  handleRoute(async (req, res) => {
    const coreInformation = optionalString(req.body?.core_information);
    const newInformation = requireString(req.body?.new_information, "new_information");

    const result = await callOpenAIJSON({
      model: updateSoulModel,
      systemPrompt:
        "You merge prior profile memory with new user info into one improved 'soul' profile. Return strictly JSON: {\"soul\":\"...\"}.",
      userPrompt: `Core information:\n${coreInformation || "(none yet)"}\n\nNew information:\n${newInformation}`
    });

    const soul = requireString(result?.soul, "soul");
    res.json({ soul });
  })
);

app.use((err, _req, res, _next) => {
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Dreamio backend listening on port ${port}`);
});
