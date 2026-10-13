export default {
  async fetch() {
    return new Response("Sylva Mail Router is running.", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },

  async email(message, env) {
    const outlook = String(
      env.OUTLOOK_DESTINATION || "sylvatechnologies@outlook.com"
    ).trim();
    const backendUrl = String(
      env.BACKEND_INBOUND_URL ||
        "https://sylva-technologies-backend.onrender.com/api/support-inbox/inbound/cloudflare"
    ).trim();
    const secret = String(env.CLOUDFLARE_EMAIL_WORKER_SECRET || "").trim();

    if (!outlook) {
      throw new Error("OUTLOOK_DESTINATION is not configured.");
    }

    // Keep payloads within the Express JSON parser and the backend's 8 MB raw-email limit.
    // Large emails still reach Outlook, but are not copied into the website inbox.
    let rawEmail = "";
    if (message.rawSize <= 6 * 1024 * 1024) {
      try {
        rawEmail = await new Response(message.raw).text();
      } catch (error) {
        console.error("Unable to read raw email for Sylva Mail:", error);
      }
    } else {
      console.error("Email exceeds Sylva Mail ingestion limit:", message.rawSize);
    }

    // Forward to the verified destination first so a backend issue cannot block Outlook.
    await message.forward(outlook);

    if (!rawEmail) {
      console.error("Email forwarded to Outlook but not copied to Sylva Mail.");
      return;
    }

    if (!secret) {
      console.error("CLOUDFLARE_EMAIL_WORKER_SECRET is not configured.");
      return;
    }

    try {
      const response = await fetch(backendUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-cloudflare-email-secret": secret,
        },
        body: JSON.stringify({ rawEmail }),
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        console.error("Sylva Mail backend rejected inbound email:", response.status, detail);
        return;
      }

      console.log("Incoming email copied to Outlook and Sylva Mail:", message.to);
    } catch (error) {
      console.error("Sylva Mail backend request failed; Outlook copy was forwarded:", error);
    }
  },
};
