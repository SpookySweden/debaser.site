-- Luke's OK in chat, 2026-11-06: the 13 older open test threads and today's private test threads, all TEST ACCOUNT A's own stream records, with no replies, pins or
-- notices to anybody real (listed and checked first). Each id is named, and the conditions repeat what was checked. Running it again deletes nothing.
delete from public.forum_threads t
using public.profiles p
where p.id = t.author_id
  and p.is_hidden
  and p.display_name = 'TEST ACCOUNT A'
  and t.title like 'STREAM :: TEST ACCOUNT A :: %'
  and t.id in (
    '11f2ecac-377f-4c30-8d29-de6cde2f8b77', '195fe835-6218-4611-8575-e2e9e9c5defb', '0ee2b9bc-c674-42be-a950-a2e0da0e0b68', '4bffbf06-20a2-4d14-a7e2-2b687255b7fb',
    'a0d26d81-c426-41fd-8e37-b178e70339f0', '81a80378-b549-49e7-ad3b-8c758be1d3be', 'df853466-ddb3-42da-a45e-813cfcd9fb67', '4fc083f9-e27f-4d5d-85b3-e30e45e505af',
    '4fe5f843-2778-44fd-84c7-b34767388e36', '3e14483c-ccac-4ef2-9f71-241bca3d03c9', 'fe133e1f-ca7b-456b-8618-db5ee9516ff1', 'f82ae602-7b78-444b-90b2-181549f76dd1',
    '6884ba57-1637-4148-a7a9-3c5b747ed892',
    '305110a5-6924-4f3d-abe4-f412026ba4ce', '139bbe24-be35-418f-b991-b18cfd1664e4', '75364719-0ccf-4025-a100-d3579450ce14', '5c9df8fc-22d7-4a2a-84fc-6c6dbabe4be6',
    '7f4bb2f3-028c-40de-81d3-1f88ff783490', '00770104-faa7-4573-939c-29b6dcc80d4d', 'b3322570-9ef6-48da-b268-cf6c5bff7039', 'fb331ee8-a439-427c-a34a-5f05f990d873',
    '7b45ed3e-aa09-4fc9-882a-892d91f1e76c', 'd5dd5024-f1b1-40ab-a480-59026274c33c', 'fb27d637-d43b-45bd-bdc4-f1e8dc44cb15'
  )
  and not exists (select 1 from public.forum_comments c where c.thread_id = t.id)
  and not exists (select 1 from public.forum_pins n where n.thread_id = t.id);
