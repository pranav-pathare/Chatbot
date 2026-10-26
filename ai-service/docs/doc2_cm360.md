# Campaign Manager 360 (CM360)

## What It Is

Campaign Manager 360 is the advertiser- and agency-side ad serving, tracking, and
measurement platform within the Google Marketing Platform. Formerly known as
DoubleClick Campaign Manager (DCM), it acts as the central ad server where
advertisers host creatives, generate tracking tags, serve ads across publishers,
and consolidate measurement into a single source of truth. Because it sits across
all media buys, CM360 is often used as the system of record for impressions,
clicks, and conversions regardless of where the media was bought.

## Account Hierarchy

CM360 is structured as **advertiser > campaign > placement > ad > creative**. An
advertiser contains campaigns; each campaign contains placements that map to the
inventory purchased on a publisher or platform; placements hold ads, and ads are
served with one or more creatives. Site and placement structures are set up to
mirror the media plan so that reporting rolls up cleanly.

## Trafficking Workflow

Trafficking in CM360 means translating a media plan into the platform: creating
campaigns and placements, uploading or linking creatives, assigning creatives to
ads, applying rotation and targeting rules, and then generating the tags that
publishers implement. Ad types include standard display, tracking ads (for
third-party-served media where CM360 only measures), and rich media or video.
Quality assurance before launch checks landing pages, click-through URLs, creative
rotation, and tag implementation.

## Floodlight and Conversion Tracking

Conversion measurement runs on **Floodlight**. A Floodlight configuration is placed
on an advertiser's site, and individual **Floodlight activities** are defined for
the actions worth measuring, such as a purchase, sign-up, or page view. Activities
are categorized as counter (counts events) or sales (captures revenue and quantity).
Floodlight data feeds attribution, audience building, and remarketing, and it is
shared with Display & Video 360 and Search Ads 360 when accounts are linked.

## Attribution, Verification, and Reporting

CM360 supports configurable attribution models to assign conversion credit across
touchpoints. Built-in verification features help confirm that ads served in viewable,
brand-safe, and geographically correct contexts. Reporting is handled through the
report builder, where standard, reach, floodlight, and path-to-conversion reports
can be built, scheduled, and exported. Key metrics include impressions, clicks, CTR,
conversions, view-through and click-through conversions, and reach.

## Integrations

CM360 is tightly integrated with the rest of the Google Marketing Platform. It
shares Floodlight and audiences with Display & Video 360 and Search Ads 360,
exchanges data with Google Analytics, and can export raw event-level data to
BigQuery through Data Transfer files for custom analysis. This integration is the
main reason agencies standardize measurement on CM360.

