# Google Analytics (GA4)

## What It Is

Google Analytics is a web and app analytics platform used to measure how users
find and interact with a site or app. The current version, Google Analytics 4
(GA4), replaced Universal Analytics, which stopped processing new data in mid-2023.
GA4 is designed around a single data model that spans both websites and mobile apps,
so cross-platform user journeys can be analyzed together.

## Event-Based Data Model

The biggest difference from Universal Analytics is that GA4 is **event-based** rather
than session-based. In GA4, every interaction is an **event** — a page view, a scroll,
a click, a purchase — and each event can carry **parameters** that add detail (for
example, a purchase event with value and currency parameters). Some events are
collected automatically, some are recommended events with predefined names, and
others are fully custom. This model is more flexible than the older category
hierarchy and maps better to how apps actually generate data.

## Key Concepts

**Conversions** (also called key events) are the events that matter most to the
business, flagged so they can be reported and used for optimization. **User
properties** describe attributes of the user, such as membership tier. GA4 uses
identity signals to stitch activity into a single user across devices where possible.
Data retention and consent settings govern how long event and user data are kept.

## Reports and Explorations

GA4 provides standard report collections for **acquisition** (how users arrive),
**engagement** (what they do), **monetization** (revenue and purchases), and
**retention** (whether they come back). For deeper, custom analysis, the
**Explorations** workspace offers techniques like free-form tables, funnels, path
analysis, and segment overlap. Audiences can be built from events and user
properties and then exported for remarketing.

## Integrations and Raw Data

GA4 links directly with Google Ads so audiences and conversions can be shared for
bidding and remarketing, and it connects with the wider Google Marketing Platform.
A defining feature is the free, native **BigQuery export**: GA4 can stream raw,
event-level data into BigQuery, letting analysts run SQL on unsampled data and join
it with other datasets. This makes GA4 a practical foundation for custom reporting
pipelines and data warehousing.

## Why It Matters for Campaigns

For campaign work, GA4 closes the loop between media and on-site behavior. Traffic
from paid campaigns can be attributed through UTM parameters and channel groupings,
engagement and conversion quality can be compared across sources, and the resulting
audiences and conversions can be pushed back into the ad platforms to improve
targeting and bidding.
