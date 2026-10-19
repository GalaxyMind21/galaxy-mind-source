// Copy for /how-to-pay-with-lightning ("No bitcoin yet? You can still pay.").
// competitor teardown lesson A2 (2026-10-18): shoppers from bitcoin.org who hold
// dollars, not bitcoin, had no path. Rules: no affiliate or referral links,
// no "best app" claims, name apps only as examples, and always tell readers
// to check availability and fees in their own app. Kept in one module so the
// visible page and the HowTo/FAQPage JSON-LD read the exact same strings.

export const PAY_GUIDE_PATH = "/how-to-pay-with-lightning";
export const PAY_GUIDE_URL = `https://galaxymind.space${PAY_GUIDE_PATH}`;

export const PAY_GUIDE_TITLE = "No bitcoin yet? You can still pay with Lightning";
export const PAY_GUIDE_META_TITLE = "How to Pay with Lightning Without Owning Bitcoin · Galaxy Mind";
export const PAY_GUIDE_DESCRIPTION =
  "No bitcoin yet? Many shops take Lightning, and some everyday money apps can pay a Lightning invoice from a dollar balance. Here is how, step by step.";
export const PAY_GUIDE_OG_ALT =
  "Galaxy Mind guide card: No bitcoin yet? You can still pay a Lightning invoice from an everyday money app.";

export const PAY_GUIDE_SHORT =
  "Many shops in the directory take Lightning, which is bitcoin's fast payment network. Some everyday money apps, such as Cash App or Strike where they are available, can pay a Lightning invoice straight from a dollar balance. You choose Lightning at checkout, scan the QR code with your app and confirm. Availability and fees vary by app and country, so check your app before you shop.";

export type PayStep = { n: string; title: string; body: string; href?: string; hrefLabel?: string };

export const PAY_STEPS: PayStep[] = [
  {
    n: "1",
    title: "Find a shop that takes Lightning",
    body: "Browse the directory and open a shop that interests you. Many listings take Lightning, and the shop's own checkout shows it as a bitcoin or Lightning option.",
    href: "/",
    hrefLabel: "Browse the directory →",
  },
  {
    n: "2",
    title: "Check that your app can pay a Lightning invoice",
    body: "Some everyday money apps, such as Cash App or Strike where they are available, can pay a Lightning invoice from a dollar balance. Look for a scan or pay option that mentions bitcoin or Lightning. Availability and fees vary by app and country, so check your app first.",
  },
  {
    n: "3",
    title: "Choose Lightning at checkout",
    body: "Fill your cart on the shop's site as usual. At the payment step, pick the bitcoin or Lightning option, and the shop shows a QR code with the exact amount.",
  },
  {
    n: "4",
    title: "Scan the QR code with your app",
    body: "Open your app's scanner and point it at the QR code. If you are shopping on the same phone, copy the invoice text and paste it into your app instead.",
  },
  {
    n: "5",
    title: "Confirm and keep your receipt",
    body: "Your app shows the total, including any fee, before you confirm. The payment usually settles in seconds, and the shop's checkout then marks your order as paid.",
  },
];

export type PayFaq = { q: string; a: string };

export const PAY_FAQ: PayFaq[] = [
  {
    q: "Do I need to own bitcoin to pay with Lightning?",
    a: "Not always. Some everyday money apps can pay a Lightning invoice from a dollar balance and handle the conversion for you. The shop still receives bitcoin, and you never have to manage a wallet yourself.",
  },
  {
    q: "Which apps can pay a Lightning invoice?",
    a: "Apps such as Cash App or Strike can, where they are available, and many bitcoin wallets can too. We do not recommend a particular app and we earn nothing from any of them. Availability and fees vary by app and country, so check your app.",
  },
  {
    q: "What does it cost?",
    a: "The Lightning network fee itself is usually tiny. Your app may add its own fee or exchange spread, and it shows you the total before you confirm.",
  },
  {
    q: "What if the invoice expires or the payment fails?",
    a: "Lightning invoices expire after a short time, often a few minutes. Go back to the shop's checkout for a fresh invoice rather than paying an old one twice. If your app shows a payment as sent but the shop does not, contact the shop with your receipt.",
  },
  {
    q: "Who handles my order, shipping and refunds?",
    a: "The shop does, under its own policies. Galaxy Mind is a directory, so you buy from and pay the shop directly, and a Lightning payment cannot be reversed by your app.",
  },
];
