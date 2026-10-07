# Google Ad Manager (GAM)

## What It Is

Google Ad Manager is a publisher-side ad management platform used to sell,
schedule, deliver, and measure advertising across websites, apps, video, and
other digital properties. It combines the capabilities of the former DoubleClick
for Publishers (DFP) ad server with the DoubleClick Ad Exchange (AdX) marketplace,
so publishers can manage both their directly sold campaigns and their programmatic
demand from a single tool.

## Core Hierarchy and Objects

Ad Manager organizes delivery around a few key objects. **Inventory** is defined
as **ad units**, which represent the places on a page or in an app where ads can
appear. Sold campaigns are entered as **orders**, and each order contains one or
more **line items** that describe what should serve, to whom, how often, and at
what price. **Creatives** are the actual ad assets (image, HTML5, video, or native)
that get associated with line items.

## Line Item Types and Priority

Delivery is governed by line item type and priority. Common types include
sponsorship and standard (guaranteed, higher priority), and network, bulk, price
priority, and house (non-guaranteed, lower priority). Sponsorship line items
typically buy a percentage of inventory and take precedence, while standard line
items deliver a fixed number of impressions over a flight. Price priority and
network line items compete largely on value, and house line items fill remaining
inventory with a publisher's own promotions. When multiple line items are eligible,
Ad Manager uses priority first, then value, to decide what serves.

## Targeting, Forecasting, and Delivery

Line items can target by inventory, geography, device, audience segments, key-values
(custom targeting), and more. Frequency caps limit how often a user sees a given
line item. Before booking guaranteed deals, traffickers use **forecasting** to
check whether enough inventory is available to meet the impression goal without
over-committing. Pacing settings control whether impressions deliver evenly across
the flight or as quickly as possible.

## Programmatic Demand

Ad Manager connects publishers to programmatic revenue through the Ad Exchange.
Deal types include **Programmatic Guaranteed** (fixed price and volume negotiated
with a specific buyer), **Preferred Deals** (a fixed price with no volume
commitment), and **Private Auctions** (invite-only auctions). **Open Bidding**
lets multiple exchanges compete in real time within Ad Manager's unified auction,
so the highest bid wins regardless of demand source.

## Reporting and Key Metrics

Reporting is done through queries that can be run, scheduled, and exported. Core
metrics include impressions, clicks, click-through rate (CTR), eCPM (effective cost
per thousand impressions), fill rate (the share of ad requests that were filled),
and revenue. Publishers watch fill rate and eCPM closely because together they
describe how well inventory is being monetized. Discrepancies between Ad Manager
counts and a buyer's ad server counts are common and are usually investigated
during reconciliation.
