/* =====================================================================
 * hub-prose.ts · unique intro prose + FAQ for the spend-bitcoin hubs
 * (de-templating pass, 2026-08-04 · roadmap item 7 of the directory-#1
 * strategy; voice pass 2026-08-05 · removed the shared rhetorical
 * skeleton — em-dash clause breaks, repeated closers, aphorism endings —
 * after a dual-agent slop audit flagged this file as the site's densest
 * AI-tell zone. Endings are deliberately varied: some hubs close on a
 * product fact, some on shipping, some on the submit form, some on
 * nothing. Do not re-unify the cadence.)
 *
 * WHY: the 20 country + 6 category hubs shared one template sentence,
 * which is the thin-content pattern search engines discount. Each hub
 * now carries 80-150 words of genuinely distinct prose plus a 3-question
 * FAQ, written FROM THE ROSTER (every specific claim names a real vendor
 * from vendors.ts) and claim-audited: no invented statistics, no
 * legal/tax claims (El Salvador's legal-tender status is the one
 * common-knowledge exception), no absolute counts in prose.
 *
 * {COUNT} in FAQ answers interpolates the LIVE per-hub vendor count at
 * render time — published numbers come from the lib that owns them,
 * never from static prose (the README rule). Hubs without an entry fall
 * back to the original template line, so a future country needs no
 * prose to launch.
 *
 * MAINTENANCE: when a hub's roster changes materially (a named vendor
 * leaves, a country doubles), refresh that hub's entry — the names in
 * prose are checked against VENDORS by scripts/check-vendors.ts's
 * sibling test suite only implicitly, so a removed vendor lingering in
 * prose is a manual review item for the quarterly sweep.
 * ===================================================================== */

import { HUB_RENT_Q, HUB_RENT_A } from "./hashrate-copy";

export type HubProse = {
  intro: string;
  faq: { q: string; a: string }[];
};

/** Keyed by ISO alpha-2 for countries, "cat:<slug>" for categories. */
export const HUB_PROSE: Record<string, HubProse> = {
  "US": {
    intro:
      "The American roster runs deeper than hoodies. Apparel is here (21 Million's signature Orange Jackets, BTC Aloha's handmade linen beachwear), but so is almost everything else. Solo Satoshi ships Bitaxe solo miners out of Houston. Bunkie Life sells ready-to-build cabin kits. Snorkel Hot Tubs builds wood-fired tubs in Seattle, and Peony Lane Wine pours low-sulfite bottles from the highest-elevation US vineyards. The services column goes further still: an American izakaya in Chicago (Fork and Coin), tax prep from a CPA (VICI TAX), wildlife removal around Indianapolis, even a self-directed bitcoin Health Savings Account. Food, shelter, tools, and professional work, all priced in sats.",
    faq: [
      { q: "Can I buy Bitcoin mining hardware with bitcoin in the United States?", a: "Yes. Solo Satoshi in Houston sells Bitaxe solo miners (Gamma, Touch, GT) plus Canaan Avalon units and Start9 nodes, FutureBit builds plug-and-play American-made nodes and miners, and GekkoScience has been designing and building home miners in America since 2013. All of them take bitcoin." },
      { q: "How many US businesses accept bitcoin on this list?", a: "{COUNT} US merchants are listed right now, spanning apparel, hardware, food and drink, books, collectibles, and services: everything from raw honey (SweetSats) to home miners (GekkoScience) to a Nashville bitcoin art museum." },
      { q: "Can I pay for services with bitcoin in the US, not just products?", a: "Yes. The services column includes tax preparation (VICI TAX), tile and flooring installation (JRC TILE), wildlife removal around Indianapolis (Admiral Wildlife Services), and a self-directed bitcoin Health Savings Account for US residents (GetSound HSA)." },
    ],
  },
  "GB": {
    intro:
      "Yojimble forages around Northampton and turns the haul into small-batch jam (\"stacking sats with jam,\" as the maker puts it), then ships it worldwide. Satoshoes handles the wardrobe with bitcoin-themed high-top and low-top sneakers, plus hoodies, tees, beanies, and mugs, also shipped worldwide. FAFORocks contributes the one item on the page that costs nothing: a free step-by-step guide to accepting bitcoin and Lightning payments for products, services, events, or donations. The UK column is short today. If you run a British shop that takes bitcoin, or know one, send it through the submit form.",
    faq: [
      { q: "What can I buy with bitcoin in the UK?", a: "Right now: bitcoin-themed sneakers, hoodies, and beanies from Satoshoes, and small-batch foraged jam from Yojimble in Northampton. {COUNT} UK merchants are listed in total, and the goods sellers ship worldwide." },
      { q: "Do UK bitcoin merchants ship internationally?", a: "Satoshoes and Yojimble both state worldwide shipping outright, so a UK address isn't required to order from either." },
      { q: "How do I start accepting bitcoin at my UK business?", a: "FAFORocks, listed on this very page, publishes a free step-by-step guide to accepting bitcoin and Lightning payments for products, services, events, or donations. Once you're taking payments, submit your shop and join the roster." },
    ],
  },
  "DE": {
    intro:
      "Germany's roster splits between things you drink and things that hash. XXI Wines pours premium wine for bitcoin, and Beehoney 21 jars premium German honey in Nakamoto and Satoshi varietals, single jars or duos, Lightning accepted. The mining bench is genuinely deep. Bitaxe Shop stocks Bitaxe and NerdQaxe solo miners (Gamma, NerdOctaxe, Avalon Nano) alongside cooling kits and the Sovereign Stack, and Open Source Miners builds its hardware by hand. orangepin21's webshop rounds things out with Bitbox and Seedor hardware, food, merch, and 3D-printed accessories.",
    faq: [
      { q: "Can I buy Bitaxe miners in Germany with bitcoin?", a: "Yes. Bitaxe Shop carries Bitaxe and NerdQaxe open-source solo miners (Gamma, NerdOctaxe, Avalon Nano) plus cooling kits and the Sovereign Stack, and Open Source Miners sells handmade open-source mining hardware. Both take bitcoin." },
      { q: "Do German shops accept Lightning payments?", a: "Every merchant in the directory accepts native bitcoin, on-chain, Lightning, or both, and Beehoney 21 calls out Lightning acceptance explicitly." },
      { q: "How many German merchants accept bitcoin here?", a: "{COUNT} at the moment: wine and honey on one side, open-source mining and hardware on the other. New German shops join the page as they're verified." },
    ],
  },
  "ZA": {
    intro:
      "One listing, and it covers more shelf than a single row in the directory suggests. Bitcoin Friendly SA is a South African marketplace and online store carrying local goods (rooibos tea, coffee, food, and crafts), all payable in bitcoin. A marketplace makes a strong opening entry for a country hub: one checkout, a range of local goods behind it. South Africa is a page we'd like to see grow. If you run a shop there that takes bitcoin, or you know one that does, the submit form is open.",
    faq: [
      { q: "Can I buy South African goods with bitcoin?", a: "Yes. Bitcoin Friendly SA runs an online marketplace and store stocking local goods like rooibos tea, coffee, food, and crafts, all payable in bitcoin." },
      { q: "How many merchants accept bitcoin in South Africa on this site?", a: "{COUNT} listed so far. Bitcoin Friendly SA is a marketplace rather than a single shop, so the entry covers a spread of local goods under one checkout. Know another South African merchant taking bitcoin? Submissions are open." },
      { q: "Do shops in South Africa take Lightning?", a: "Every listing in this directory accepts native bitcoin, on-chain or over Lightning. Check Bitcoin Friendly SA's checkout for which rail a given order runs on." },
    ],
  },
  "IT": {
    intro:
      "Italy's roster is small but unusually tangible. Sat's Oil ships limited-edition extra-virgin olive oil from a family grove in Sicily, worldwide. isolabellart sells original oil paintings, each one of a kind, priced in bitcoin. afilini turns open-source design into 3D-printed Bitcoin gadgets you can inspect down to the design files. Nothing here is a gift card or a workaround: these are merchants selling their own goods and choosing to be paid in bitcoin directly. If you've been waiting for a reason to spend rather than stack, dinner and art are a decent place to start.",
    faq: [
      { q: "Can I buy olive oil with bitcoin in Italy?", a: "Yes. Sat's Oil, a family olive grove in Sicily, sells limited-edition extra-virgin olive oil for bitcoin and ships worldwide, so you don't need to be in Italy to order a tin." },
      { q: "How many merchants accept bitcoin in Italy?", a: "The live count for Italy is {COUNT}, covering consumables and collectibles: Sicilian olive oil, original oil paintings, and open-source 3D-printed Bitcoin gadgets among them." },
      { q: "Do Italian vendors take Lightning payments?", a: "Every vendor listed here accepts native bitcoin, on-chain or over Lightning. The exact rails offered at checkout vary by shop, so the vendor's own store page is the final word." },
    ],
  },
  "PE": {
    intro:
      "Peru's page currently comes down to one merchant, and it earns the slot. Delgado's Fuego makes authentic Peruvian hot sauces built on the rocoto pepper (Misti-uchu among them) and rounds out the shelf with branded tees for anyone who wants to advertise their tolerance. That's the whole list. Single-vendor pages are how every country hub here starts; the interesting part is what shows up second. If you run a Peruvian business that takes bitcoin, or know one, the submit form is open.",
    faq: [
      { q: "Can I buy Peruvian hot sauce with bitcoin?", a: "Yes. Delgado's Fuego sells authentic rocoto-based hot sauces, including its Misti-uchu, plus branded tees, and accepts bitcoin for all of it." },
      { q: "How many merchants accept bitcoin in Peru?", a: "The live count for Peru is {COUNT}. It's an early list. If you run or know a Peruvian business that accepts bitcoin, the submit form is open, and new listings are reviewed before they go live." },
      { q: "Does Delgado's Fuego accept Lightning?", a: "All vendors in this directory accept native bitcoin payments, on-chain or over Lightning. For the specific rails offered at checkout, the shop itself is the authority." },
    ],
  },
  "FR": {
    intro:
      "Factory House takes 21 percent off when you pay with bitcoin, on-chain or Lightning, across its catalog of bitcoin apparel, accessories, home decor, and books. A standing discount at the till tells you where the shop stands: it would rather be paid in bitcoin, and prices accordingly. France's roster holds a single listing for now. If you're replacing a hoodie, furnishing a shelf, or stacking books to hand the next skeptic, the bitcoin price here is simply the better price.",
    faq: [
      { q: "Is there a discount for paying with bitcoin in France?", a: "Yes. Factory House takes 21 percent off when you pay with bitcoin, whether on-chain or over Lightning. That's the shop's own standing offer, straight from its listing." },
      { q: "What can I buy with bitcoin in France?", a: "The live count here is {COUNT}, so the catalog is concentrated: bitcoin apparel, accessories, home decor, and books, all from Factory House." },
      { q: "Do French shops in this directory take Lightning?", a: "Factory House explicitly accepts both on-chain and Lightning payments, and applies its 21 percent bitcoin discount either way." },
    ],
  },
  "CH": {
    intro:
      "Switzerland's two listings cover an unusually wide span. FBO Developments writes software for self-sovereign tech and data, building, in its own words, for an economy free of digital middlemen. BTC SWAG prints the apparel, posters, and accessories, including community swag for stacker.news. Professional services and physical goods on the same page, paid the same way, is what this directory is for, and Switzerland manages it with two rows. Both vendors take bitcoin natively.",
    faq: [
      { q: "Can I pay for software development with bitcoin in Switzerland?", a: "Yes. FBO Developments is a Swiss software shop focused on self-sovereign tech and data, and it takes bitcoin for the work." },
      { q: "Where can I buy bitcoin merch in Switzerland?", a: "BTC SWAG sells bitcoin apparel, accessories, and posters, including stacker.news community swag, and accepts bitcoin natively." },
      { q: "How many Swiss merchants accept bitcoin here?", a: "Switzerland's live count is {COUNT}, split between professional services and apparel. Every listed vendor takes native bitcoin, on-chain or over Lightning." },
    ],
  },
  "CO": {
    intro:
      "The Bitcoin Coffee Guy ships Colombian specialty coffee in 340g bags, plus Bitcoiner bracelets and keychains for the drawer next to the grinder, and settles over on-chain or Lightning, whichever your wallet speaks. Bitcoin Beans covers the other bean: 100 percent Colombian cacao, paid for in bitcoin. Coffee and chocolate are repeat purchases, which makes this page more useful than its size suggests. A standing coffee order is an easy way to make spending bitcoin a habit.",
    faq: [
      { q: "Can I buy Colombian coffee with bitcoin?", a: "Yes. The Bitcoin Coffee Guy sells Colombian specialty coffee in 340g bags and accepts both on-chain and Lightning payments." },
      { q: "How many merchants in Colombia accept bitcoin?", a: "The live count is {COUNT}. Right now the roster is all consumables: specialty coffee from The Bitcoin Coffee Guy and 100 percent Colombian cacao from Bitcoin Beans." },
      { q: "Do vendors in Colombia take Lightning?", a: "The Bitcoin Coffee Guy explicitly accepts both on-chain and Lightning. Every vendor in the directory takes native bitcoin; confirm the exact rail at each shop's checkout." },
    ],
  },
  "TH": {
    intro:
      "Thailand's listing is Seedkeys, maker of physical Bitcoin security tools: tamper-evident stainless-steel seed-phrase backups, plus the Penlock. Steel backups are the unglamorous end of self-custody. You buy one once, and you're glad of it on the day paper fails. If you run a Thailand-based business that sells everyday goods for bitcoin, the submit form is the fastest way to grow this hub. Until then, Seedkeys holds the page solo.",
    faq: [
      { q: "Can I buy a seed-phrase backup with bitcoin in Thailand?", a: "Yes. Seedkeys sells tamper-evident stainless-steel seed-phrase backups and the Penlock, physical Bitcoin security tools, paid for in bitcoin." },
      { q: "How many shops in Thailand accept bitcoin?", a: "This page lists {COUNT} at the moment, and the number is live. It grows as new Thai merchants are verified into the directory." },
      { q: "Does Seedkeys ship outside Thailand?", a: "The listing states no shipping restriction, and most vendors in the directory ship internationally. Confirm destinations and rates with Seedkeys before ordering." },
    ],
  },
  "SI": {
    intro:
      "TonyCe is Slovenia's entry in the directory: bitcoin wallets and merch from a Slovenian webshop run by the president of Bitcoin Association Slovenia. Provenance like that counts here. An association president is about as public as a merchant identity gets, and this directory cares who stands behind a storefront. The catalogue is practical, too. A wallet is the piece of kit every bitcoiner eventually needs, and here you can pay for it in sats.",
    faq: [
      { q: "Can I buy a bitcoin wallet with bitcoin in Slovenia?", a: "Yes. TonyCe, a Slovenian webshop run by the president of Bitcoin Association Slovenia, sells bitcoin wallets and merch for bitcoin." },
      { q: "How many merchants in Slovenia accept bitcoin?", a: "The live count on this page is {COUNT}. New Slovenian merchants join the hub as soon as they are verified into the directory." },
      { q: "Do shops in Slovenia take Lightning?", a: "Every vendor listed in the directory accepts native bitcoin, on-chain, Lightning, or both. The rail a given shop supports is best confirmed at its own checkout." },
    ],
  },
  "NZ": {
    intro:
      "Poppy is the whole roster here, and the roster is wearable: bitcoin merch and apparel out of New Zealand. A t-shirt is a classic first purchase. It's a low-stakes way to learn how painless paying a merchant in bitcoin actually is, and unlike most low-stakes purchases it keeps working after checkout, advertising the network every time it leaves the wardrobe. Hubs grow the way the wider directory grows, a merchant at a time. Know a New Zealand business selling physical goods for bitcoin? Send it in.",
    faq: [
      { q: "Can I buy clothes with bitcoin in New Zealand?", a: "Yes. Poppy sells bitcoin merch and apparel from New Zealand, paid for directly in bitcoin." },
      { q: "How many shops in New Zealand accept bitcoin?", a: "{COUNT} right now. The count is live and updates as New Zealand merchants are added to the directory." },
      { q: "Does Poppy ship outside New Zealand?", a: "Nothing in the listing restricts shipping, and most directory vendors ship internationally. Check destination and cost with Poppy before paying." },
    ],
  },
  "SV": {
    intro:
      "El Salvador made bitcoin legal tender, which might make a directory page here feel redundant, but a curated list still earns its keep by naming names. Ours starts with The Trading Channel, which runs a free Twitch trading stream, sells paid TradingView and MetaTrader indicators, and keeps a shelf of Bitcoin memorabilia for collectors, the physical-goods side of an otherwise digital operation. The roster here is small, and that is the honest picture: legal tender changed the rules nationwide, but verification still happens one merchant at a time. If you run a Salvadoran business that takes bitcoin for everyday goods, the submit form is the fastest way onto this page.",
    faq: [
      { q: "Can I spend bitcoin at businesses in El Salvador?", a: "Bitcoin is legal tender in El Salvador, so spending it there is not the novelty it is elsewhere. This page tracks the human-verified slice: the live count currently reads {COUNT}, and it grows as merchants pass review." },
      { q: "What can I buy with bitcoin from The Trading Channel?", a: "The Trading Channel runs a free Twitch trading stream and sells paid TradingView and MetaTrader indicators, plus Bitcoin memorabilia. The memorabilia is the physical-goods side of the listing." },
      { q: "Do merchants in El Salvador accept Lightning payments?", a: "Every vendor in this directory accepts bitcoin natively, Lightning, on-chain, or both. Check the vendor's profile or shop page for which rail they prefer at checkout." },
    ],
  },
  "NL": {
    intro:
      "Bitcoin Brabant anchors the Dutch roster: an EU bitcoin-only reseller of hardware and one of the longest-running official Bitaxe partners, the first, per its listing, to sell them at scale. A bitcoin-only hardware shop is a useful kind of merchant to have on the books. It sells the machines the network runs on and takes the network's own money for them. The Netherlands page is short today. If you run a Dutch business selling physical goods for bitcoin, the submit form is open, and a human reviews every claim.",
    faq: [
      { q: "Can I buy bitcoin mining hardware in the Netherlands with bitcoin?", a: "Yes. Bitcoin Brabant is an EU bitcoin-only hardware reseller and one of the longest-running official Bitaxe partners. The checkout takes the same money the machines mine." },
      { q: "How many Dutch shops accept bitcoin on this list?", a: "The live count for the Netherlands currently reads {COUNT}. It is a curated roster, not a census: every entry is verified by a human, and new Dutch merchants can join via the submit form." },
      { q: "Does Bitcoin Brabant ship outside the Netherlands?", a: "Its listing describes an EU reseller, and most vendors in the directory ship internationally unless their description says otherwise. Confirm shipping terms on the vendor's own shop page before ordering." },
    ],
  },
  "HU": {
    intro:
      "TitanDot anchors the Hungarian roster with premium titanium seed-phrase backup plates built for long-term self-custody, the kind of purchase you make once and hope never to test. The list here is short, and we publish it anyway. A directory that only covered big markets would miss pages like this one. Hungarian merchants selling physical goods for bitcoin can apply through the submit form; a human reviews every claim before it goes live.",
    faq: [
      { q: "Can I buy a seed phrase backup in Hungary with bitcoin?", a: "Yes. TitanDot sells premium solid-titanium seed phrase backup plates built for long-term self-custody, and accepts bitcoin for them." },
      { q: "Do shops in Hungary take Lightning?", a: "Vendors in this directory accept bitcoin natively, Lightning, on-chain, or both. The specific rail is on each vendor's profile or shop page, so check there before checkout." },
      { q: "How many bitcoin merchants are listed in Hungary?", a: "The count for Hungary currently reads {COUNT}, each one human-verified. If you run or know a Hungarian business selling physical goods for bitcoin, the submit form is how the number moves." },
    ],
  },
  "ES": {
    intro:
      "Home mining has a hobbyist end, small and open-source, sitting on a desk instead of in a warehouse, and Spain has a shop built for exactly that. Nerdminer Store describes itself as Europe's first open-source Bitcoin mining shop and has been supplying home miners since 2023: gear that is open by design and personal in scale. Know a Spanish business selling physical goods for bitcoin, or run one? Send it through the submit form. Every listing is checked by a human before it appears.",
    faq: [
      { q: "Where can I buy home bitcoin mining gear in Spain with bitcoin?", a: "Nerdminer Store, by its own billing Europe's first open-source Bitcoin mining shop, has supplied home miners since 2023 and takes bitcoin at checkout." },
      { q: "How many Spanish merchants accept bitcoin in this directory?", a: "The live count for Spain reads {COUNT}. It is a verified roster rather than a scrape, which is why it starts small and only grows when a human confirms a merchant is genuine." },
      { q: "Do Spanish vendors ship internationally?", a: "Most vendors in the directory ship internationally unless their listing says otherwise, but shipping terms live with the merchant, not with us. Check Nerdminer Store's shop page for current options and costs." },
    ],
  },
  "AU": {
    intro:
      "Lightning Bazaar is Australia's presence in the directory, and it refuses to specialize: raw honey, 3D prints, vinyl, eBooks, even a crypto-ticker gadget, all payable on-chain or over Lightning. The bazaar format suits bitcoin commerce, one merchant selling what they actually make and like rather than what a category page demands. The Australian roster is short for now, and a single checked listing beats twenty unverified ones. If you run an Australian shop that takes bitcoin, or you know one, the submission form is the fastest way to grow this page.",
    faq: [
      { q: "Can I buy things with bitcoin from Australian shops?", a: "Yes. The Australian roster here currently stands at {COUNT}, led by Lightning Bazaar, an online bazaar selling raw honey, 3D prints, vinyl, eBooks and a crypto-ticker gadget for on-chain or Lightning payment." },
      { q: "Do Australian merchants in this directory accept Lightning?", a: "Lightning Bazaar takes both on-chain and Lightning, so small orders can settle instantly without waiting on a block. Every vendor in the directory accepts native bitcoin on at least one of those rails." },
      { q: "How do I get my Australian shop listed?", a: "Use the submit form on this site. A human reviews every submission before it goes live, and you'll need an X or Nostr profile so buyers have an identity to inspect." },
    ],
  },
  "CA": {
    intro:
      "You could assemble a decent morning entirely from this page. Coffee from Trails Coffee, a specialty roaster in Anmore, BC: single-origin Guatemalan, their Buntzen Blend, a monthly subscription if you're committed. A cordovan wallet or a signing-device case from Leathermint, which builds leather goods around the Bitcoin standard. Something engraved or hand-built from Bitcoin Manor, whose catalog runs from laser work and woodworking to Bitcoin Metric Displays. Small-batch, Italian-made underwear from Panties For Bitcoin, a niche nobody else on this list is competing for. And when the roster runs out, CoinCards turns sats into gift cards, mobile top-ups and prepaid vouchers, no account needed, which extends bitcoin's reach to shops that have never heard of it. Canada is one of the deeper benches in this directory.",
    faq: [
      { q: "What can I buy with bitcoin in Canada?", a: "Specialty coffee from Trails Coffee, leather wallets and belts from Leathermint, laser engravings and woodwork from Bitcoin Manor, small-batch underwear from Panties For Bitcoin, and gift cards or mobile top-ups through CoinCards. {COUNT} verified merchants in all." },
      { q: "Can I use bitcoin for everyday spending in Canada?", a: "CoinCards is the bridge: it sells gift cards, mobile top-ups and prepaid vouchers for on-chain bitcoin or Lightning with no account needed, which covers a lot of stores that don't take bitcoin directly." },
      { q: "Do Canadian vendors here take Lightning?", a: "Every vendor in the directory accepts native bitcoin, on-chain, Lightning, or both; CoinCards names both rails explicitly. Check each shop's checkout for which it offers." },
    ],
  },
  "AT": {
    intro:
      "Austria's entry in the directory is Go₿rrr.me, a shop for open-source Bitcoin hardware and on-demand 3D prints: Bitaxe and NerdQaxe miners, SeedSigner builds, node hardware. The person who wants to tinker with a Bitaxe or assemble their own SeedSigner is usually the same person who'd rather not route the purchase through a card network, and here they don't have to. Austria's roster is a roster of one today. That's an honest count of what we've checked, not a statement about the country. If you're an Austrian merchant taking bitcoin for everyday goods, the submission form is open.",
    faq: [
      { q: "Can I buy a Bitaxe or SeedSigner with bitcoin in Austria?", a: "Yes. Go₿rrr.me sells Bitaxe and NerdQaxe miners, SeedSigner builds and node hardware, all open-source, plus on-demand 3D prints, and accepts bitcoin for the lot." },
      { q: "How many shops in Austria accept bitcoin?", a: "This directory's verified Austrian count currently sits at {COUNT}. That's the number a human has actually checked, not an estimate of the whole country. Unverified shops simply aren't listed." },
      { q: "Does Go₿rrr.me ship outside Austria?", a: "The listing doesn't spell out a shipping range, so confirm at checkout. Most online vendors in this directory ship beyond their home country unless they say otherwise." },
    ],
  },
  "FI": {
    intro:
      "Finland's presence in the directory is currently a single shop: Lady Laurette, linen dresses and natural-fabric clothing, made in Finland, for people who'd rather settle in bitcoin. \"High quality clothing for high quality money\" is the shop's own line, and it's a better pitch than anything we could write for it. We verify slowly and list only what checks out, so the Finnish roster grows at the speed of verified merchants. Know a Finnish shop that takes bitcoin? Point them at the submission form.",
    faq: [
      { q: "Can I buy clothing with bitcoin in Finland?", a: "Yes. Lady Laurette sells linen dresses and natural-fabric clothing made in Finland and accepts bitcoin for it." },
      { q: "How many Finnish merchants are in the directory?", a: "Finland currently accounts for {COUNT} of the directory's verified listings. Every entry clears a human check before it appears, so the number only counts merchants somebody has actually confirmed." },
      { q: "Do Finnish vendors accept Lightning payments?", a: "All directory vendors accept native bitcoin, on-chain, Lightning, or both. Check Lady Laurette's own checkout to see which rail the shop offers." },
    ],
  },
  "BR": {
    intro:
      "Brazil's first listings here are two different kinds of shop. Homedock is a furniture and décor e-commerce that has shipped nationwide since 2013 and takes bitcoin on-chain or over Lightning at checkout. KriptoBR, based in São Paulo, is an official reseller of Trezor, Ledger, SecuX and YubiKey, with stock in the country and a BTCPay checkout that takes bitcoin. Physical shops in Brazil still live on BTC Map. This page is the online-store slice a human has actually checked. Know another Brazilian shop that takes bitcoin for everyday goods? The submit form is open.",
    faq: [
      { q: "Can I buy furniture with bitcoin in Brazil?", a: "Yes. Homedock sells furniture and home décor, ships nationwide, and takes bitcoin on-chain or Lightning at checkout." },
      { q: "Can I buy a hardware wallet with bitcoin in Brazil?", a: "Yes. KriptoBR is an official Trezor, Ledger, SecuX and YubiKey reseller stocked in São Paulo. Checkout is BTCPay (on-chain bitcoin). They ship inside Brazil, not internationally." },
      { q: "How many Brazilian online shops accept bitcoin on this list?", a: "{COUNT} verified online merchants right now. Street-level shops (cafés, bars) are tracked on BTC Map, not here." },
    ],
  },
  "cat:apparel": {
    intro:
      "Bitcoin apparel has outgrown the logo tee. The bigger shops here run full lines: 21 Million does technical streetwear and swimwear, The Orange Habit dresses men, women, children, and pets, and Factory House knocks 21 percent off when you pay in bitcoin. The specialists go deep on one thing each: Lady Laurette's natural-fabric clothing made in Finland, Satoshoes' high-top and low-top sneakers shipped worldwide, Leathermint's belts and signing-device cases, Panties For Bitcoin's small-batch intimates made in Italy.",
    faq: [
      { q: "Can I buy clothes with bitcoin?", a: "Yes. {COUNT} apparel merchants here accept bitcoin directly, from full streetwear lines like 21 Million to made-in-Finland linen from Lady Laurette. Every listing accepts native on-chain or Lightning payment." },
      { q: "Is bitcoin clothing all logo t-shirts?", a: "No. The roster runs from Satoshoes' sneakers to Panties For Bitcoin's small-batch intimates made in Italy to Leathermint's cordovan wallets and belts. Plenty of it carries no logo at all." },
      { q: "Do bitcoin apparel shops ship internationally?", a: "Most do. Satoshoes states worldwide shipping outright. Merchants based abroad, like Lady Laurette in Finland and Panties For Bitcoin in Italy, list shipping details on their own shops, so check the listing before ordering." },
    ],
  },
  "cat:hardware": {
    intro:
      "Everything in this category mines, secures, or runs bitcoin, and all of it is paid for in bitcoin. On the mining bench: Solo Satoshi ships Bitaxe solo miners and Start9 nodes out of Houston, and GekkoScience has been designing and building home miners in America since 2013. Bitcoin Brabant and the Nerdminer Store cover Europe with open-source rigs. Rigly Block Party is a weekly Saturday mining party: buy hashrate in bitcoin or point your own miner with the group. For custody, Seedkeys cuts tamper-evident stainless-steel seed backups and Foundation builds the Passport Prime, a security platform that folds 2FA codes and security keys in with self-custody. ReHash Heating will turn your hashrate into home heat, and if you need somewhere to put all of it, Bunkie Life sells ready-to-build cabin kits, also for bitcoin. Galaxy Mind also rents named USA ASICs by the day, for 1 to 30 days, pointed at the pool you choose.",
    faq: [
      { q: "Can I buy a bitcoin miner with bitcoin?", a: "Yes. Solo Satoshi, the Bitaxe Shop, and GekkoScience all sell home mining hardware for bitcoin, including Bitaxe and NerdQaxe open-source solo miners. FutureBit adds American-made plug-and-play nodes and miners for home setups." },
      { q: "Can I buy hardware wallets and seed backups with bitcoin?", a: "Yes. Foundation sells the Passport Prime security platform, Seedkeys makes tamper-evident stainless-steel seed-phrase backups, and KriptoBR is an official Trezor, Ledger and SecuX reseller in Brazil. All take bitcoin." },
      { q: "Is home mining hardware available outside the US?", a: "Yes. Of the {COUNT} hardware merchants listed, several are European: Bitcoin Brabant is one of the longest-running official Bitaxe partners in the EU, and the Nerdminer Store calls itself Europe's first open-source bitcoin mining shop." },
      { q: HUB_RENT_Q, a: HUB_RENT_A },
    ],
  },
  "cat:consumables": {
    intro:
      "Coffee first, because it's always coffee first: Satoshi Coffee Co. sells specialty beans for on-chain or Lightning, Trails Coffee roasts single-origin Guatemalan in Anmore, BC, and The Bitcoin Coffee Guy ships Colombian beans alongside bitcoiner bracelets. Then the pantry widens. Beehoney 21 jars German honey in Nakamoto and Satoshi varietals; SweetSats trades pure raw honey out of the US. Sat's Oil presses limited-edition extra-virgin olive oil on a family grove in Sicily and ships it worldwide. Peony Lane pours low-sulfite wine from the highest-elevation vineyards in the US, Yojimble forages small-batch jam in Northampton, England, and Delgado's Fuego bottles authentic Peruvian rocoto hot sauce. If it goes on a shelf or in a cup, someone here will take sats for it.",
    faq: [
      { q: "Can I buy coffee with bitcoin?", a: "Yes. {COFFEE} roasters here take it and ship beans: Satoshi Coffee Co. (on-chain or Lightning), Trails Coffee in Anmore, BC, and The Bitcoin Coffee Guy with Colombian specialty beans. Trails also runs a monthly subscription. Walk-in cups are on BTC Map. Full list: /buy-coffee-with-bitcoin." },
      { q: "What food and drink can I actually buy with bitcoin?", a: "{COUNT} merchants in this category sell everyday consumables: honey from Germany (Beehoney 21) and the US (SweetSats), Sicilian olive oil (Sat's Oil), low-sulfite wine (Peony Lane), Peruvian hot sauce (Delgado's Fuego), and foraged English jam (Yojimble)." },
      { q: "Do these food merchants ship internationally?", a: "Several say so explicitly. Sat's Oil and Yojimble both ship worldwide. For the rest, check the merchant's own shop for where they deliver." },
    ],
  },
  "cat:collectibles": {
    intro:
      "No two items on this page came off the same production line, which is roughly the point. GoldfishThumb1 hand-engraves one-off dive-style watches. Onyx Cat Pottery throws functional pieces on the wheel, nine years into the craft. isolabellart paints in oils (time, silence, and light), each work unique and priced in bitcoin. On the printed side, CryptoCloaks turns Colorado filament into home-miner builds and hardware-wallet cases, while afilini keeps its bitcoin gadgets open source. For collectors proper, Bitcoin Trading Cards issues physical cards with finite supply and transparent provenance, and Satosphere makes a solar-ambient globe that powers itself from indoor light, no plug, no battery. Artists and makers who price their work in sats tend to mean it.",
    faq: [
      { q: "Can I buy art with bitcoin?", a: "Yes. isolabellart sells unique oil paintings priced in bitcoin, GoldfishThumb1 makes one-off hand-engraved dive-style watches plus pencil and paint artwork, and RiverMesa handcrafts Southwest jewelry in stamped copper, turquoise, and leather." },
      { q: "What counts as a bitcoin collectible?", a: "Across the {COUNT} merchants here: physical trading cards with finite supply (Bitcoin Trading Cards), 3D-printed gadgets and miner builds (CryptoCloaks, afilini), handmade pottery (Onyx Cat Pottery), and a self-powering solar-ambient globe (Satosphere)." },
      { q: "Are these items handmade or mass-produced?", a: "Overwhelmingly small-batch or one-of-a-kind. GoldfishThumb1's watches are one-off pieces, every isolabellart painting is unique, and NoWasteBTCSigns builds its signs and decor by hand from sustainable, low-waste materials." },
    ],
  },
  "cat:services": {
    intro:
      "A CPA, a hot-tub builder, a VPN, and a wildlife-removal crew, all invoicing in sats. Some of it is local: Fork and Coin runs an American izakaya in Chicago's Portage Park, Admiral Wildlife Services covers homes and businesses around Indianapolis, and Snorkel Hot Tubs builds wood-fired tubs in Seattle. Some of it works from anywhere: VICI TAX handles US tax prep, SlingshotVPN encrypts your traffic, and CoinCards converts on-chain or Lightning into gift cards and mobile top-ups with no account needed. At the infrastructure end, Lightning Enable is wiring AI agents to pay for API access over Lightning.",
    faq: [
      { q: "What services can I pay for with bitcoin?", a: "{COUNT} merchants here invoice in bitcoin, from US tax preparation (VICI TAX) and a self-directed bitcoin Health Savings Account (GetSound HSA, for US residents) to VPN service (SlingshotVPN) and tile and flooring installation (JRC TILE)." },
      { q: "Can I buy gift cards with bitcoin?", a: "Yes. CoinCards sells gift cards, mobile top-ups, and prepaid vouchers for on-chain bitcoin or Lightning, with no account needed." },
      { q: "Are these services online or local?", a: "Both. SlingshotVPN and CoinCards work from anywhere; Fork and Coin serves Chicago's Portage Park, Admiral Wildlife Services covers the Indianapolis area, and Bitcoin Park runs physical campuses in Nashville and Austin." },
    ],
  },
  "cat:books": {
    intro:
      "Saifedean Ammous, the economist who wrote The Bitcoin Standard, sells his books here directly. The kids' section is genuinely competitive. SHAmory pairs a STEM-authenticated card game with the Goodnight Bitcoin bedtime book, Lindey Magee wrote a rhyming picture book sold solo or in classroom packs, and 603BTC covers both education playing cards and a children's title. Bitcoin Art Magazine documents the movement's artists in print, PirateHash stocks books and posters for tactile plebs, and ScoreVivo, improbably, sells downloadable flute sheet music. FAFORocks gives its step-by-step guide to accepting bitcoin payments away free.",
    faq: [
      { q: "Can I buy bitcoin books with bitcoin?", a: "Yes. {COUNT} merchants here sell books and educational goods for bitcoin, including Saifedean Ammous's own shop, where the author of The Bitcoin Standard sells his work directly." },
      { q: "Are there bitcoin books for kids?", a: "Several. Lindey Magee's rhyming picture book comes solo or in classroom packs, SHAmory pairs its card game with the Goodnight Bitcoin bedtime book, and 603BTC publishes a children's book alongside its education playing cards." },
      { q: "Is there anything for merchants who want to accept bitcoin?", a: "Yes. FAFORocks publishes a free step-by-step guide to accepting bitcoin and Lightning payments. It costs nothing, which makes it a sensible first stop before you spend anything at all." },
    ],
  },
};
