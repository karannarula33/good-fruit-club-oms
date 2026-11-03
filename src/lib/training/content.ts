// Learn GFC starter content, written from the "GFC Operations Handbook for
// Navya" (3 Nov 2026). Loaded into the database once by
// scripts/seed_training.ts; after that the database is the source of truth
// and the admin edits modules in the OMS (Learn GFC > Edit), which bumps the
// module's version.
//
// Format: see src/lib/training/markdown.ts. Screens are separated by a line
// "---". Open points Karan confirmed on 3 Nov 2026 are written in; the one
// still open (the weekly off day) is a "> ⚠️ Check with Karan: ..." flag and
// no quiz question depends on it.

export interface SeedQuestion {
  kind?: "mcq" | "scenario";
  scenario?: string;
  prompt: string;
  options: string[];
  correct: number;
  explanation: string;
}

export interface SeedModule {
  slug: string;
  title: string;
  summary: string;
  content: string;
  questions: SeedQuestion[];
}

export const TRAINING_MODULES: SeedModule[] = [
  {
    slug: "start-here",
    title: "Start here",
    summary: "Who we are, the three rules that never bend, and who to ask.",
    content: `## Who we are

Good Fruit Club (GFC) is a **premium fruit concierge**: we hand-pick exotic and Indian fruit each morning and deliver it to members' doors across Gurgaon and Delhi.

- We call customers **members**.
- Most members are in DLF Phases 1–5, Sushant Lok and nearby Gurgaon.
- About two-thirds of members order again, so every conversation is the start of a relationship.

---

## Your role

As Social Media & Community Manager you own four things:

1. Every member conversation on WhatsApp and Instagram.
2. Daily order collation into the OMS.
3. Delivery updates to members.
4. Posts and social content.

The handbook is your reference. Anything flagged **Check with Karan** isn't settled yet, so check before you promise it to a member.

---

## Three rules that never bend

1. **Speak as Good Fruit Club.** Every message goes out as GFC, not as you personally. Never mention Karan or the team behind the scenes.
2. **Never promise what you can't see.** Stock, delivery time, price and customisation: if it isn't in the handbook or the OMS, ask before you commit.
3. **Every order gets written down.** An order that only lives in a chat will get missed.

---

## Who to go to

| Topic | Ask |
| --- | --- |
| Orders, pricing, stock, refunds, anything unusual | Karan |
| Packing questions on the day | Kunal (packer) |
| Gurgaon delivery on the day | Sanjeet (delivery) |`,
    questions: [
      {
        prompt: "A member asks who runs Good Fruit Club. How do you reply?",
        options: [
          "Tell them Karan and his family run it",
          "Speak as Good Fruit Club, a premium fruit concierge, without naming anyone behind the scenes",
          "Give them Karan's personal number",
        ],
        correct: 1,
        explanation: "Rule 1: every message goes out as Good Fruit Club. Never mention Karan or the team behind the scenes.",
      },
      {
        prompt: "A member asks if you can deliver a fruit tomorrow that you can't see in the OMS or on the site. What do you do?",
        options: [
          "Say yes, it will probably be available",
          "Check with Karan before you commit",
          "Say no, we never stock it",
        ],
        correct: 1,
        explanation: "Rule 2: never promise what you can't see. If it isn't in the handbook or the OMS, ask before you commit.",
      },
      {
        prompt: "A regular confirms an order on WhatsApp late in the evening. When does it go into the OMS?",
        options: [
          "Right away: every order gets written down",
          "Tomorrow morning, with the other orders",
          "Only if they've paid",
        ],
        correct: 0,
        explanation: "Rule 3: every order gets written down. An order that only lives in a chat will get missed.",
      },
      {
        prompt: "A packing question comes up on the day (which box an order went in). Who do you ask?",
        options: ["Sanjeet", "Kunal", "The member"],
        correct: 1,
        explanation: "Kunal is the packer and handles packing questions on the day. Sanjeet handles Gurgaon delivery.",
      },
    ],
  },
  {
    slug: "products-pricing",
    title: "Products and pricing",
    summary: "How weight, piece and box pricing work, pre-orders, and what we sell.",
    content: `## The website is the price list

**goodfruit.club is the live price list.** Always quote from it: prices change with the season, and anything written down goes out of date.

> Tip: keep the site open on your phone while you chat, and copy the price straight from the product page.

---

## How pricing works

- **Weight pricing:** most fruit is sold by weight. Some fruit has both a 500g price and a 1kg price. Below **0.7kg** the 500g rate applies; at **0.7kg and above** the 1kg rate applies. There are no further discounts above 1kg.
- **Per piece or per box:** some fruit is priced this way instead, for example dragon fruit, avocado, pineapple, kiwi boxes, blueberry punnets and Rockit tubes.
- **Pre-order items** carry a **PRE-ORDER** tag on the site and deliver in **2–4 days**, not the same day. Donut Peach is on pre-order right now.
- **Free replacements:** a ₹0 line on an order is usually a free replacement for a poor-quality item.

---

## Hero fruit right now

As on the price list of 3 Nov 2026 (always check the site for today's price):

| Fruit | Price | Delivery |
| --- | --- | --- |
| Mangosteen | ₹600 / 500g · ₹1,150/kg for 1kg+ | Same / next day |
| Longan | ₹470 / 500g · ₹900/kg for 1kg+ | Same / next day |
| Donut Peach | ₹650 / box (6–7 pc, 500g) | Pre-order, 2–4 days |
| Fuyu Persimmon | See site | Same / next day |
| Chikoo | See site | Same / next day |
| Medjool Dates | ₹990 / 500g | Same / next day |

---

## Other ranges

- **Everyday fruit:** citrus, apples, pears, grapes, bananas, papaya, melons and more.
- **Daily Staples Mix Box:** ₹650.
- **High Protein Atta (Good Staples):** 5kg ₹1,100, 1kg ₹250, 500g ₹180.
- **Gifting:** gift boxes, custom gift boxes and Pooja/Prasad hampers (module 8).

**What's in season?** Whatever is on the site right now. A fruit that has run out shows **Notify me** instead of a price; tell the member it's out for now and offer to message them when it's back.`,
    questions: [
      {
        prompt: "Where do you take the price from when you quote a member?",
        options: ["The handbook table", "The website, goodfruit.club", "Last week's order"],
        correct: 1,
        explanation: "The website is the live price list. Prices change with the season, so written tables go out of date.",
      },
      {
        prompt: "A member wants 600g of a fruit that has a 500g price and a 1kg price. Which rate applies?",
        options: ["The 500g rate", "The 1kg rate", "Whichever is cheaper"],
        correct: 0,
        explanation: "Below 0.7kg the 500g rate applies; at 0.7kg and above the 1kg rate applies.",
      },
      {
        prompt: "A member orders Donut Peach today. When should they expect it?",
        options: ["Same day", "Next day", "In 2–4 days: it's a pre-order item"],
        correct: 2,
        explanation: "Pre-order items carry a PRE-ORDER tag and deliver in 2–4 days, not the same day.",
      },
      {
        prompt: "You see a ₹0 line on a member's order. What is it usually?",
        options: ["A mistake to fix", "A free replacement for a poor-quality item", "A free sample for new members"],
        correct: 1,
        explanation: "A ₹0 line is usually a free replacement for a poor-quality item from an earlier delivery.",
      },
    ],
  },
  {
    slug: "orders-in",
    title: "How orders come in",
    summary: "Website, WhatsApp and ads, and taking a WhatsApp order step by step.",
    content: `## Three ways in

Every order has to end up in the OMS before the day's packing sheet is built.

| Channel | What happens | Your job |
| --- | --- | --- |
| **Website** (goodfruit.club) | The member orders and pays online or picks cash on delivery. The order lands in the OMS automatically. | Check it came through and the address is complete. Answer follow-up questions. |
| **WhatsApp** (87000 53315) | The member messages what they want, often loosely: "1kg mangosteen and some apples". | Confirm items, quantities, address and delivery day, then enter the order in the OMS. |
| **Meta ads** | Fruit ads send people to the product page. Gift box ads open a WhatsApp chat with a pre-filled message. | Reply to gift enquiries fast (modules 8 and 11). |

---

## Taking a WhatsApp order (1–4)

1. **Reply within minutes** during working hours. A slow first reply loses the order.
2. **Confirm each item** with its quantity and price from the site, e.g. "Mangosteen 1kg ₹1,150, Kinnaur Apple 1kg ₹330".
3. **Confirm the full address.** New members need a building or tower, flat number and landmark. Ask for a Google Maps pin if the area is new to us.
4. **Confirm the delivery day** using the cut-off rule (module 4). Mention when an item is on pre-order.

---

## Taking a WhatsApp order (5–7)

5. **Confirm how they'll pay** (module 5).
6. **Enter the order in the OMS straight away**, not at the end of the day.
7. **Send a short confirmation:** items, total, delivery day and window, and payment.

---

## Try it: Order Entry

\`\`\`tryit
title: Look around Order Entry (don't save)
href: /admin/orders
- Open Order Entry. This is where WhatsApp orders go in.
- Paste a member's message with their name first, e.g. "Rita Parkash: 1kg mangosteen, 2 dozen kela".
- Press Parse and look at the review: the matched member, each line, and any line flagged for attention.
- Don't press Save: this is practice. Close the page when you've looked around.
\`\`\`

> Practice orders that are kept off packing sheets are coming soon. Until then, never save a test order.`,
    questions: [
      {
        prompt: "A website order comes in. What's your job?",
        options: [
          "Re-enter it in the OMS by hand",
          "Check it came through and the address is complete, and answer follow-ups",
          "Nothing at all",
        ],
        correct: 1,
        explanation: "Website orders land in the OMS automatically. You check they came through with a complete address.",
      },
      {
        prompt: "A new member gives only \"DLF Phase 3\" as the address. What do you ask for?",
        options: [
          "Nothing, the delivery person will find it",
          "Building or tower, flat number and a landmark (and a Maps pin if the area is new to us)",
          "Their email address",
        ],
        correct: 1,
        explanation: "New members need a building or tower, flat number and landmark. Ask for a Google Maps pin if the area is new to us.",
      },
      {
        prompt: "When should a confirmed WhatsApp order go into the OMS?",
        options: ["Straight away", "At the end of the day", "When the member pays"],
        correct: 0,
        explanation: "Enter it straight away, not at the end of the day.",
      },
      {
        prompt: "What goes in your confirmation message to the member?",
        options: [
          "Just \"Done!\"",
          "Items, total, delivery day and window, and payment",
          "The packing sheet number",
        ],
        correct: 1,
        explanation: "A short confirmation lists the items, total, delivery day and window, and payment.",
      },
    ],
  },
  {
    slug: "delivery",
    title: "Delivery: where, when and how much",
    summary: "Cut-offs, delivery windows, charges and the updates to send.",
    content: `## The cut-off

- **Ordered before 10 AM:** same day, if the fruit is in the morning's buying buffer.
- **Ordered after 10 AM:** next day.
- **Orders confirmed by the night before** are delivered the next day.
- **Pre-order items** (e.g. Donut Peach): 2–4 days after booking.
- **Gift boxes:** about 2 days' notice.

The promise to give members is the site's window: **2–8 PM**.

---

## When things usually arrive

| Order | Usually arrives |
| --- | --- |
| Delhi | Afternoon (leaves Paschim Vihar about 11:30 AM) |
| Gurgaon, most areas | 2–5 PM |
| Gurgaon, farther areas (15–20 km+) | 6–7 PM |

Always promise 2–8 PM; the table is what usually happens.

---

## Delivery charges

| City | Delivery fee |
| --- | --- |
| Delhi | ₹49 on orders below ₹1,000; free from ₹1,000 |
| Gurgaon | ₹49 on orders below ₹500; free from ₹500 |

**Where we deliver:** Gurgaon and Delhi (the site accepts 122… and 11… pincodes). Outside them (Noida, Faridabad, Ghaziabad and beyond), say no kindly by default. For a gift or large order in Noida or Faridabad, check with Karan before saying no.

**Cash on delivery** costs nothing extra.

---

## Updates to send

- **Morning of delivery:** confirm the order and the delivery window.
- **When it's out:** "Your Good Fruit Club order is on its way."
- **Running late:** message the member **before** the window closes, not after.`,
    questions: [
      {
        prompt: "A Delhi order comes to ₹850. What's the delivery fee?",
        options: ["Free", "₹49", "₹99"],
        correct: 1,
        explanation: "Delhi orders below ₹1,000 pay ₹49; from ₹1,000 delivery is free.",
      },
      {
        prompt: "A Gurgaon order comes to ₹650. What's the delivery fee?",
        options: ["Free", "₹49", "₹99"],
        correct: 0,
        explanation: "Gurgaon delivery is free from ₹500.",
      },
      {
        prompt: "A member orders at 11:30 AM. When will it arrive?",
        options: ["Today, 2–8 PM", "Tomorrow, 2–8 PM", "In 2–4 days"],
        correct: 1,
        explanation: "Orders after 10 AM are delivered the next day, in the 2–8 PM window.",
      },
      {
        prompt: "A member in Noida wants a regular fruit order delivered. What do you say?",
        options: [
          "Yes, same as Gurgaon",
          "No, kindly: we deliver in Gurgaon and Delhi (check with Karan only for a Noida gift or large order)",
          "Yes, with a ₹99 fee",
        ],
        correct: 1,
        explanation: "We deliver to Gurgaon and Delhi. Outside them it's a kind no by default; Noida or Faridabad gift and large orders are checked with Karan.",
      },
      {
        prompt: "A member paying cash on delivery asks if there's an extra charge for that. What do you say?",
        options: ["Yes, ₹49", "No, cash on delivery costs nothing extra", "Only in Delhi"],
        correct: 1,
        explanation: "There's no fee for cash on delivery, in Gurgaon or Delhi.",
      },
      {
        prompt: "A delivery is running late. When do you message the member?",
        options: ["After the window closes", "Before the window closes", "Only if they ask"],
        correct: 1,
        explanation: "Message before the window closes, not after.",
      },
    ],
  },
  {
    slug: "payments",
    title: "Payments",
    summary: "When members pay, how to collect, and quality complaints.",
    content: `## When members pay

We accept online payments and cash on delivery, with no minimum order.

| Member | When they pay |
| --- | --- |
| Past member, any order | Before or after delivery, whichever they prefer |
| New member, regular order | Online or on delivery |
| New member, large order (**₹3,000 or more**: gifts, bulk, corporate) | Ask for full or part payment **upfront** before we confirm |

---

## How to collect

- **UPI QR code:** share our QR for quick payments.
- **Razorpay link:** a payment link for that specific order. Karan creates these for now, so send him the member's name, order and amount, and share the link once he sends it.
- **Website orders:** paid at checkout, or cash on delivery.

---

## Quality complaints

Our default fix is a **free replacement in the next delivery**, logged as a ₹0 line in the OMS. We don't usually collect the bad item back.

**Refunds** are only for when a replacement isn't possible or the member can't take one. **Karan approves every refund**: never promise one yourself. Say you'll check and come back to them, and pass it to Karan the same day.`,
    questions: [
      {
        prompt: "A past member asks if they can pay after delivery. What do you say?",
        options: ["Yes, before or after delivery, whichever they prefer", "No, upfront only", "Only by card"],
        correct: 0,
        explanation: "Past members can pay before or after delivery, whichever they prefer.",
      },
      {
        prompt: "A new member wants a large gift order. What do you do before confirming?",
        options: [
          "Confirm it and collect cash on delivery",
          "Ask for full or part payment upfront",
          "Refuse the order",
        ],
        correct: 1,
        explanation: "New members with large orders (gifts, bulk, corporate) pay in full or part upfront before we confirm.",
      },
      {
        prompt: "A new member wants a ₹3,400 gift box. When do they pay?",
        options: ["On delivery, like everyone", "Upfront (full or part) before we confirm: it's ₹3,000 or more", "After they've tasted it"],
        correct: 1,
        explanation: "New members pay upfront for large orders: ₹3,000 or more (gifts, bulk, corporate).",
      },
      {
        prompt: "A member asks for their money back instead of a replacement. What do you do?",
        options: [
          "Refund it yourself",
          "Don't promise a refund; say you'll check and pass it to Karan, who approves every refund",
          "Refuse: we only replace",
        ],
        correct: 1,
        explanation: "Refunds are only when a replacement isn't possible or wanted, and Karan approves every one. Never promise it yourself.",
      },
      {
        prompt: "A member needs a payment link for their WhatsApp order. What do you do?",
        options: [
          "Make one yourself in Razorpay",
          "Send Karan the member's name, order and amount, then share the link he sends",
          "Ask them to order on the website instead",
        ],
        correct: 1,
        explanation: "Karan creates Razorpay links for now. Send him the details and share the link once he sends it.",
      },
      {
        prompt: "A member says some fruit was poor. What's our default fix?",
        options: [
          "A refund straight away",
          "A free replacement in the next delivery, logged as a ₹0 line",
          "Collect the fruit back first",
        ],
        correct: 1,
        explanation: "The default is a free replacement in the next delivery, logged as a ₹0 line. We don't usually collect the bad item.",
      },
    ],
  },
  {
    slug: "a-day-at-gfc",
    title: "A day at GFC: sourcing to doorstep",
    summary: "From the 11 PM collation to the doorstep, and what it means for you.",
    content: `## The night before decides the next day

Orders collated by **11 PM** become the morning's buying list, and everything is packed in Paschim Vihar before noon.

| Time | What happens | Where |
| --- | --- | --- |
| By 11 PM (night before) | All orders collated in the OMS. The buying list goes to our main vendor with a 20% buffer. | OMS |
| 6–7:30 AM | Fruit is sourced. Same-morning orders are filled from the buffer. | Vendor |
| Morning | Packing from the day's packing sheet | Paschim Vihar hub |

---

## From hub to doorstep

| Time | What happens | Where |
| --- | --- | --- |
| ~11:30 AM | Delhi orders go out for delivery. Gurgaon orders leave for the Gurgaon hub. | Paschim Vihar |
| 1–1:30 PM | Gurgaon orders reach the Gurgaon hub | Gurgaon hub |
| 2–5 PM | Gurgaon deliveries, most areas | Gurgaon |
| 6–7 PM | Gurgaon deliveries, farther areas (15–20 km+) | Gurgaon |

---

## What this means for you

- **The 11 PM deadline is yours.** Every confirmed WhatsApp order must be in the OMS by 11 PM, or it can't be bought for the next morning.
- **Morning orders depend on the buffer.** Before you confirm one, check the fruit is likely to be in the buffer. Ask Karan or the hub if unsure.
- **Unavailable items:** if an item couldn't be sourced, tell the member the same day. If they still want it, enter it as a new order for the next day (these show as carry-forwards on the packing sheet).

---

## Reading the packing sheet

- **Gurgaon** orders appear under **green** headings, **Delhi** under **brown**.
- **Carry-forwards** from yesterday are in **blue** and must never be missed.
- **Late additions:** once the packing sheet is shared, its order numbers are fixed. A late order gets the next number after the last one.`,
    questions: [
      {
        prompt: "A member orders at 9 PM for tomorrow. By when must it be in the OMS?",
        options: ["11 PM tonight", "7 AM tomorrow", "Before dispatch at 11:30 AM"],
        correct: 0,
        explanation: "Orders collated by 11 PM become the morning's buying list. After that it can't be bought for the next morning.",
      },
      {
        prompt: "What does the buying list include on top of the orders?",
        options: ["Nothing extra", "A 20% buffer", "Double the orders"],
        correct: 1,
        explanation: "The buying list goes to the vendor with a 20% buffer, which is how same-morning orders get filled.",
      },
      {
        prompt: "On the packing sheet, what colour are yesterday's carry-forwards?",
        options: ["Green", "Brown", "Blue"],
        correct: 2,
        explanation: "Carry-forwards are blue and must never be missed. Green is Gurgaon, brown is Delhi.",
      },
      {
        prompt: "An item couldn't be sourced this morning. What do you do?",
        options: [
          "Remove it from the order quietly",
          "Tell the member the same day and, if they still want it, enter it as a new order for tomorrow",
          "Wait for the member to notice",
        ],
        correct: 1,
        explanation: "Tell the member the same day. If they still want it, enter it as a new order for the next day.",
      },
    ],
  },
  {
    slug: "the-oms",
    title: "The OMS: your screens and daily routine",
    summary: "What your login can do, your screens, and the daily routine.",
    content: `## Every order lives here

The OMS is our in-house web app. Every order lives here, whether it came from the website or WhatsApp. The packing and delivery sheets are built from it, so **an order that isn't in the OMS doesn't get packed**.

| Login | Can do |
| --- | --- |
| Admin (Karan) | Everything, including costs and reports |
| Customer engagement (you) | Learn GFC, Order Entry (with prices), Engagement, and the delivery Route (view only) |
| Packer (Kunal) | Sees and enters orders, without prices |
| Delivery (Sanjeet) | The delivery route |

---

## Your screens

- **Orders:** enter WhatsApp orders. Paste the member's message with their name first, review, save.
- **Engagement:** members who are due to order again or have gone quiet, with a suggested message. Relay it on WhatsApp, skip it, or snooze it for 3 days.
- **Route:** the day's delivery stops (dispatched, out for delivery, delivered), with each member's phone. View only: delivery staff mark the status.
- **Learn:** this course, and the handbook to look things up later.

---

## Try it: Route

\`\`\`tryit
title: Check today's deliveries
href: /delivery
- Open Route. Each card is one stop, sorted in delivery order.
- Find which stops are out for delivery and which are delivered.
- Use the date arrows to look at yesterday: these are the members to call for feedback.
\`\`\`

---

## Try it: Engagement

\`\`\`tryit
title: Look at today's nudges
href: /admin/engagement
- Open Engagement and read the first nudge: who it's for, why, and the suggested message.
- Don't press Relay unless you're actually sending the message.
\`\`\`

---

## Your daily routine

1. **Morning:** check the Route and send the day's delivery updates.
2. **Through the day:** enter WhatsApp orders as you confirm them.
3. **Afternoon:** call yesterday's delivered members for feedback (Route, yesterday's date). Log any complaint.
4. **Evening:** send reorder nudges from Engagement, then make sure every confirmed order is in by **11 PM**.

The OMS is still being built, so some screens may change. Tell Karan if something looks wrong.`,
    questions: [
      {
        prompt: "Why does every order have to be in the OMS?",
        options: [
          "For the monthly report only",
          "The packing and delivery sheets are built from it, so an order not in the OMS doesn't get packed",
          "So members can see it",
        ],
        correct: 1,
        explanation: "The packing and delivery sheets are built from the OMS. If it isn't in the OMS, it doesn't get packed.",
      },
      {
        prompt: "Where do you find the members to call for feedback?",
        options: [
          "Route, with yesterday's date: the delivered stops",
          "The Prices screen",
          "Instagram",
        ],
        correct: 0,
        explanation: "Yesterday's delivered stops on the Route are the members to call for feedback.",
      },
      {
        prompt: "A stop shows as delivered by mistake. Can you change it on the Route?",
        options: ["Yes, tap it", "No: the Route is view only for you; tell Karan or Sanjeet", "Delete the order"],
        correct: 1,
        explanation: "Your Route is view only. Delivery staff and the admin change delivery status.",
      },
      {
        prompt: "When do you send reorder nudges?",
        options: ["Morning", "Evening, before the 11 PM check", "Never"],
        correct: 1,
        explanation: "Evening: send reorder nudges, then make sure every confirmed order is in by 11 PM.",
      },
    ],
  },
  {
    slug: "gifting",
    title: "Gifting",
    summary: "Set boxes, custom boxes and sizes, hampers, and corporate orders.",
    content: `## Set boxes or custom

Gift boxes sell all year, and most need **about 2 days' notice**. Every box is either one of our **set boxes** (named, priced, on the site) or a **custom box** built around the member's budget and taste. Most chats start with a set box and end with a small change.

The Diwali ads use shorter names for some boxes, so members may ask for either. Each pair is the same box at the same price.

---

## Set boxes (premium)

Prices from the site, 3 Nov 2026.

| Site name | Name in ads | Price |
| --- | --- | --- |
| The Prestige Exotic Box | The Keepsake Case | from ₹3,500 |
| The Grand Harvest Box | The Grand Diwali Box | from ₹3,490 |
| The Radiance Box | The Radiance Box | from ₹3,490 |
| The Jewel Box | — | from ₹3,490 |
| The Golden Mango Box | — | from ₹3,690 |

The Prestige Exotic Box comes in an acrylic case with pear, peach, mangosteen, gold kiwi, imported mango, blueberry, red grapes and NZ apple.

---

## Set boxes (everyday gifting)

| Site name | Name in ads | Price |
| --- | --- | --- |
| The Berry Orchard Box | The Berry Box | from ₹2,890 |
| The Exotic Trio Box | The Exotics Case | from ₹2,490 |
| The Sunrise Orchard Box | The Sunrise Box | from ₹2,400 |
| The Tropical Harvest Box | The Tropical Box | from ₹2,300 |
| The Pear & Pomegranate Box | The Orchard Box | from ₹2,000 |
| The Mango Legacy Box | — | from ₹1,990 |

**Watch-outs:** peaches are on pre-order and the Prestige Exotic Box has them, so offer a swap if the date is close. Mango boxes (Mango Legacy, Golden Mango, and Grand Harvest's mangoes) depend on mango availability: check before you confirm.

---

## Custom boxes

Price = the fruit at our normal prices + the box. Custom boxes start from about **₹1,600** all-in.

| Box | Holds up to | Box charge |
| --- | --- | --- |
| Standard 12 × 12 inch box | 3.5 kg of fruit | +₹400 |
| Large box with a sling | 4 kg of fruit | +₹700 |

**Pooja and Prasad hampers:** ₹300–600, plus ₹30 per hamper for gift packaging.

---

## Building a box with a member

1. **Find out three things:** the budget per box, how many boxes, and the delivery date and address.
2. **Suggest 2–3 set boxes** near the budget, with photos.
3. **Customise only if they want to:** swap fruit of similar value, add a favourite, drop a dislike.
4. **Choose the box size by weight:** up to 3.5 kg standard, up to 4 kg large with a sling.
5. **Use seasonal fruit** and **lead with colour:** bright fruit up front, an exotic or two as the hero.
6. **Confirm everything in writing:** contents, price, box, date, address and payment. New members with large orders pay upfront.

---

## Corporate and bulk orders

- Collect the **company name, number of boxes, budget per box, dates, one or many addresses**, and whether they want a **logo card**.
- We can add a branded logo card for the company.
- **Send it all to Karan for a quote.**
- **No bulk discounts as a rule.** A special request is passed to Karan or Shubhangi, who decide; never offer one yourself.
- **20+ boxes need about 3 days' notice.**

If someone quotes an old ₹1,200 custom-box screenshot, check with Karan.`,
    questions: [
      {
        prompt: "A custom box will hold 3.8 kg of fruit. Which box, and what's the box charge?",
        options: ["Standard box, +₹400", "Large box with a sling, +₹700", "Two standard boxes, +₹800"],
        correct: 1,
        explanation: "The standard box holds up to 3.5 kg. Up to 4 kg goes in the large box with a sling, +₹700.",
      },
      {
        prompt: "A new member wants 15 corporate boxes. What do you do before confirming?",
        options: [
          "Quote 10% off and confirm",
          "Collect the brief, send it to Karan for a quote, and take upfront payment",
          "Ask them to order on the website",
        ],
        correct: 1,
        explanation: "Collect the full brief and send it to Karan for a quote; never quote bulk discounts yourself. New members with large orders pay upfront.",
      },
      {
        prompt: "A member asks for \"The Keepsake Case\" from an ad. Which box is that?",
        options: ["The Prestige Exotic Box", "The Radiance Box", "The Berry Orchard Box"],
        correct: 0,
        explanation: "The Keepsake Case is the ad name for The Prestige Exotic Box: same box, same price.",
      },
      {
        prompt: "A company ordering 30 boxes asks for 10% off. What do you say?",
        options: [
          "Agree, bulk gets 10%",
          "We don't usually discount; you'll pass the request on (Karan or Shubhangi decide)",
          "Offer 5% instead",
        ],
        correct: 1,
        explanation: "No bulk discounts as a rule. Special requests go to Karan or Shubhangi; never offer one yourself.",
      },
      {
        prompt: "How much notice do 20+ corporate boxes need?",
        options: ["Same day", "About 3 days", "Two weeks"],
        correct: 1,
        explanation: "20+ boxes need about 3 days' notice.",
      },
      {
        prompt: "How much notice do most gift boxes need?",
        options: ["Same day", "About 2 days", "A week"],
        correct: 1,
        explanation: "Most gift boxes need about 2 days' notice.",
      },
      {
        kind: "scenario",
        scenario: "Hi! I'd like to order a Diwali gift box",
        prompt: "This message came from a gift ad. What's the best reply?",
        options: [
          "Hi! Our boxes start at ₹1,990. Here's the link to the site.",
          "Hi! Lovely, happy to help. What budget per box do you have in mind, how many boxes, and which date should they arrive?",
          "Hi! Please call us to discuss.",
        ],
        correct: 1,
        explanation: "Start by finding out the three things: budget per box, how many boxes, and the date (and address). Then suggest 2–3 set boxes.",
      },
      {
        kind: "scenario",
        scenario: "Can I get the Prestige box delivered tomorrow?",
        prompt: "The Prestige Exotic Box has peaches, which are on pre-order. What do you reply?",
        options: [
          "Sure, it will reach you tomorrow!",
          "The peaches in that box are on pre-order (2–4 days). For tomorrow we can swap them for another exotic of similar value. Shall I do that?",
          "Sorry, that box isn't available.",
        ],
        correct: 1,
        explanation: "Peaches are on pre-order, so offer a swap if the date is close. Never promise what you can't see.",
      },
    ],
  },
  {
    slug: "customisations",
    title: "Customisations",
    summary: "What we say yes to, and how to record it for the packer.",
    content: `## Say yes, and write it down

Say yes to reasonable customisations. **Write every one into the OMS order notes** so the packer sees it. A request that only lives in the chat will be missed.

---

## Common requests

| Request | What we do |
| --- | --- |
| Custom gift box | The member picks the fruit, or gives a budget and we build it. Priced by size (module 8). |
| Swap a fruit in a gift box | Offer a fruit of similar value that's in stock. Confirm before packing. |
| Logo card (corporate) | Yes, collect the logo file early. |
| Ripeness ("ready to eat today" vs "for later in the week") | Note it on the order for the packer. |
| Exact count or size ("6 large apples") | Note it. Weight items are still billed on actual weight. |

---

## Gifts to someone else, and regulars

| Request | What we do |
| --- | --- |
| Delivery to someone else | Collect the recipient's name, number and address, and whether to call before delivery. |
| Gift message or note | On request, free. Collect the exact message and write it in the order notes. |
| Weekly or regular orders | Some members already get a weekly box against a set budget, and a subscription feature is coming. Pass interested members to Karan. |`,
    questions: [
      {
        prompt: "A member wants their mangosteen \"ready to eat today\". Where does that go?",
        options: ["Nowhere, the packer will guess", "In the OMS order notes for the packer", "Only in the WhatsApp chat"],
        correct: 1,
        explanation: "Write every customisation into the OMS order notes so the packer sees it.",
      },
      {
        prompt: "A member wants \"6 large apples\". How are they billed?",
        options: ["Per apple", "On the actual weight packed", "A flat price"],
        correct: 1,
        explanation: "Note the count, but weight items are still billed on actual weight.",
      },
      {
        prompt: "A member wants a note in their gift box. What do you do?",
        options: ["Charge ₹100 for it", "Collect the exact message and add it to the order notes; it's free", "Say we don't do notes"],
        correct: 1,
        explanation: "Gift notes are free on request. Collect the exact message and write it in the order notes for the packer.",
      },
      {
        prompt: "A gift is going to someone else. What do you collect?",
        options: [
          "Just the address",
          "The recipient's name, number and address, and whether to call before delivery",
          "The recipient's email",
        ],
        correct: 1,
        explanation: "Collect the recipient's name, number and address, and whether to call before delivery.",
      },
    ],
  },
  {
    slug: "talking-to-members",
    title: "Talking to members",
    summary: "Our voice, house style, playbooks, and when to escalate.",
    content: `## Our voice

Warm, personal and premium. Picture a **knowledgeable friend who picks fruit for you**, not a store. Keep replies short and specific, and end each one with a clear next step.

- **Respect:** greet by name with ji where natural ("Hi Meera ji"). Write in English; switch to Hindi or Hinglish if the member does.
- **Specifics:** "Mangosteen is ₹1,150/kg, delivered today 2–8 PM" beats "Sure, we have it!"
- **Honesty:** if fruit isn't up to our standard, say so and offer an alternative.
- **Light emoji:** one at most, and only where it fits.
- **Positioning:** a premium fruit concierge. Never "family-run", and never mention who is behind the scenes.

---

## Playbooks: selling

| Situation | What to do |
| --- | --- |
| New enquiry from an ad | Reply fast and ask one question that moves things on: "Is this for yourself or as a gift? Which day would you like it?" |
| Gift enquiry | Find out budget, how many boxes, date and recipient, then suggest 2–3 boxes. |
| Corporate enquiry | Collect the full brief and pass it to Karan for a quote within the day. |
| Repeat member | Remember what they like and mention what's in season. |
| Price objection | Explain what they're paying for (hand-picked each morning, quality-checked). Don't discount on your own; suggest a smaller pack to try. |

---

## Playbooks: when things go wrong

| Situation | What to do |
| --- | --- |
| Out of stock | Say so early; offer a similar fruit or the next available date. |
| Running late | Message before the window ends, apologise once, give a new time. |
| Quality complaint | Thank them, ask for a photo, apologise, offer a replacement next delivery. Log it in the OMS. |
| Angry member | Stay calm, don't argue. Acknowledge, fix what you can, escalate to Karan the same day. |
| Outside our area | Say no kindly; offer a drop point only if Karan has approved one. |

---

## Always escalate to Karan

- A refund request.
- Any order over ₹15,000.
- A media, influencer or partnership request.
- A legal, health or allergy concern.
- Anything you're unsure about.

(Corporate discount requests can go to Karan or Shubhangi.)`,
    questions: [
      {
        prompt: "Which reply fits our house style?",
        options: [
          "Sure, we have it!! 🍊🍊🍊",
          "Hi Meera ji, mangosteen is ₹1,150/kg and can reach you today, 2–8 PM. Shall I add 1kg?",
          "Yes available. Price on website.",
        ],
        correct: 1,
        explanation: "Greet by name, give specifics (fruit, price, day) and end with a clear next step. One emoji at most.",
      },
      {
        prompt: "A member asks for a refund. What do you do?",
        options: ["Process it yourself", "Escalate to Karan", "Refuse politely"],
        correct: 1,
        explanation: "Refund requests always go to Karan.",
      },
      {
        prompt: "A member wants to place a ₹18,000 order. What do you do?",
        options: ["Take it like any order", "Escalate to Karan: it's over ₹15,000", "Ask for a discount code"],
        correct: 1,
        explanation: "Any order over ₹15,000 is escalated to Karan.",
      },
      {
        prompt: "A member says the price is too high. What do you do?",
        options: [
          "Give 10% off to keep them",
          "Explain what they're paying for, and suggest a smaller pack to try; don't discount on your own",
          "Tell them other shops are more expensive",
        ],
        correct: 1,
        explanation: "Explain the value (hand-picked each morning, quality-checked) and never discount on your own.",
      },
      {
        kind: "scenario",
        scenario: "The papaya you sent yesterday was completely overripe. Very disappointed.",
        prompt: "What's the best reply?",
        options: [
          "Sorry, papaya ripens fast at home.",
          "Thank you for telling us, and I'm sorry. Could you share a photo? We'll replace it with your next delivery.",
          "We'll refund you right away.",
        ],
        correct: 1,
        explanation: "Quality complaint playbook: thank them, ask for a photo, apologise and offer a replacement next delivery, then log it in the OMS. Refunds go to Karan.",
      },
      {
        kind: "scenario",
        scenario: "Where is my order?? It was supposed to come by 8 and it's 8:15 now. This is ridiculous.",
        prompt: "What's the best reply?",
        options: [
          "Our window is 2–8 PM, please be patient.",
          "I completely understand, and I'm sorry. Let me check right away and come back to you with an exact time in a few minutes.",
          "It's not our fault, traffic is bad.",
        ],
        correct: 1,
        explanation: "Angry member: stay calm, don't argue, acknowledge and fix what you can, then escalate to Karan the same day. (Next time, message before the window closes.)",
      },
    ],
  },
  {
    slug: "whatsapp-ads",
    title: "WhatsApp and ad enquiries",
    summary: "The business number, ad enquiries, labels, and working rules.",
    content: `## The business WhatsApp

The business WhatsApp is **87000 53315**, which you use as a linked device on your phone. Every ad, the website and Google point to this number.

- **Phone stays in sync:** don't log out or delete chats. Tell Karan if the linked device disconnects.

---

## Enquiries from ads

- **Gift ads** open a chat with a pre-filled message. Personal gift ads say "Hi! I'd like to order a Diwali gift box". Corporate ads say "Hi! I'm enquiring about corporate Diwali gift boxes".
- **Auto-greeting:** an automatic greeting replies first and asks for details. Your first real reply should still come **within 10 minutes** during working hours.
- **Fruit ads** send people to the website. Questions about specific fruit ("is the persimmon sweet?") often follow on WhatsApp.

---

## Labels and daily tracking

- **Label** ad chats (for example "Gift lead" or "Corporate lead") so we can see which ads bring real orders.
- **At the end of each day**, note how many ad enquiries came in and how many became orders. That tells us which ads to keep.

---

## Working rules

- **One voice:** every message is from Good Fruit Club. No personal numbers, and no forwarding member chats outside the team.
- **Privacy:** never share a member's details with another member.
- **No silent closes:** reply to every chat, even to say "we'll get back to you by 6 PM".

---

## Hours and the away message

- **Reply hours: 9 AM–9 PM.** Inside these, first replies within 10 minutes.
- **After hours,** the WhatsApp away message (9 PM–9 AM) says:

> "Thanks for messaging Good Fruit Club! We're back at 9 AM and will reply first thing. To order now, visit goodfruit.club."

- Still make sure every confirmed order is in the OMS by **11 PM**.

> ⚠️ Check with Karan: your weekly off day, and who covers chats that day.`,
    questions: [
      {
        prompt: "An ad enquiry got the auto-greeting. How soon should your first real reply come?",
        options: ["Within 10 minutes during working hours", "By the end of the day", "The auto-greeting is enough"],
        correct: 0,
        explanation: "The auto-greeting replies first, but your first real reply should come within 10 minutes during working hours.",
      },
      {
        prompt: "What are the WhatsApp reply hours?",
        options: ["24 hours", "9 AM–9 PM, with the away message after hours", "10 AM–6 PM"],
        correct: 1,
        explanation: "Replies 9 AM–9 PM; the away message covers 9 PM–9 AM.",
      },
      {
        prompt: "Why do we label ad chats like \"Gift lead\" or \"Corporate lead\"?",
        options: ["To look organised", "To see which ads bring real orders", "WhatsApp requires it"],
        correct: 1,
        explanation: "Labels, and the end-of-day count of enquiries vs orders, tell us which ads to keep.",
      },
      {
        prompt: "A member asks for another member's number to share a gift order. What do you do?",
        options: ["Share it", "Never share a member's details with another member", "Share it if they're neighbours"],
        correct: 1,
        explanation: "Privacy: never share a member's details with another member.",
      },
      {
        prompt: "You can't answer a member's question yet. What do you do?",
        options: [
          "Leave it until you know",
          "Reply anyway, e.g. \"we'll get back to you by 6 PM\"",
          "Mark the chat as read",
        ],
        correct: 1,
        explanation: "No silent closes: reply to every chat, even to say when you'll get back to them.",
      },
    ],
  },
];
