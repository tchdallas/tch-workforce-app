-- Full-day time off was stored at UTC midnight of the chosen days. Texas is
-- UTC-5/-6, so every list rendered the dates a day early (submit Oct 27-28,
-- see Oct 26-27), end_at sat at the *start* of the last day so conflict
-- checks never covered it, and a same-day request failed the
-- "end_at > start_at" check because both were the same instant.
--
-- New scheme (the client now writes this): start_at = local midnight,
-- end_at = local 23:59:59 of the end day, America/Chicago. Convert the rows
-- written under the old scheme; the UTC-midnight guard makes this idempotent.
update public.time_off_requests
set start_at = (start_at at time zone 'utc')::date::timestamp at time zone 'America/Chicago',
    end_at   = case when end_at is null then null
                    else ((end_at at time zone 'utc')::date::timestamp
                          + interval '23 hours 59 minutes 59 seconds')
                         at time zone 'America/Chicago' end
where start_at = date_trunc('day', start_at at time zone 'utc') at time zone 'utc';
