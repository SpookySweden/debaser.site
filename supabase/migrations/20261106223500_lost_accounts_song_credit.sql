-- A profile song's credit can't be null, and a restored song may have none. Found by the test that undoes itself, before anybody signed up.
create or replace function public.restore_lost_account(person uuid, mail text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.account_restores%rowtype;
  version_id uuid;
begin
  select * into r from public.account_restores a where a.email = lower(coalesce(mail, '')) and a.claimed_by is null for update;
  if not found then return false; end if;

  update public.profiles p
  set display_name = r.display_name,
      name_colour = coalesce(r.name_colour, p.name_colour),
      country_code = coalesce(r.country_code, p.country_code)
  where p.id = person;

  if r.avatar_src is not null then
    insert into public.profile_avatar_versions (user_id, version, src, note)
    values (person, 1, r.avatar_src, 'Restored after the accounts were lost')
    returning id into version_id;
    update public.profiles p set current_version_id = version_id where p.id = person;
  end if;

  if r.song_src is not null then
    insert into public.profile_song_versions (user_id, version, src, title, credit, note)
    values (person, 1, r.song_src, coalesce(r.song_title, ''), coalesce(r.song_credit, ''), 'Restored after the accounts were lost')
    returning id into version_id;
    update public.profiles p set current_song_version_id = version_id where p.id = person;
  end if;

  -- Their old posts kept the name they were written under, and nothing else: that name is how they come home.
  update public.forum_threads t set author_id = person where t.author_id is null and t.author_label = r.display_name;
  update public.forum_comments c set author_id = person where c.author_id is null and c.author_label = r.display_name;
  update public.profile_comments c set author_id = person where c.author_id is null and c.author_label = r.display_name;
  update public.music_tracks m set uploaded_by = person where m.uploaded_by is null and m.uploaded_by_label = r.display_name;
  update public.media_items m set uploaded_by = person where m.uploaded_by is null and m.uploaded_by_label = r.display_name;
  update public.music_folders f set created_by = person where f.created_by is null and f.created_by_label = r.display_name;
  update public.forum_pins f set pinned_by = person where f.pinned_by is null and f.pinned_by_label = r.display_name;

  update public.account_restores a set claimed_by = person, claimed_at = now() where a.email = r.email;
  return true;
end;
$$;
revoke all on function public.restore_lost_account(uuid, text) from public, anon, authenticated;
