-- Add UTM attribution columns to arena_class_bookings so bookings coming from
-- ad campaigns (e.g. booking.20fit.id/?utm_source=meta+ads&utm_campaign=the+grind)
-- can be traced back to their source in the admin hub Class Bookings page.
ALTER TABLE public.arena_class_bookings
  ADD COLUMN IF NOT EXISTS utm_source   text,
  ADD COLUMN IF NOT EXISTS utm_medium   text,
  ADD COLUMN IF NOT EXISTS utm_campaign text;

-- Grants on this table are column-scoped, so new columns need explicit grants:
-- the admin panel (anon key) reads them; the booking app (anon key) writes them.
GRANT SELECT (utm_source, utm_medium, utm_campaign) ON public.arena_class_bookings TO anon, authenticated, service_role;
GRANT INSERT (utm_source, utm_medium, utm_campaign) ON public.arena_class_bookings TO anon, authenticated, service_role;
GRANT UPDATE (utm_source, utm_medium, utm_campaign) ON public.arena_class_bookings TO anon, authenticated, service_role;
