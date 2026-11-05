-- PinkPocket: ubah tabel menjadi satu ruang data bersama TANPA login.
-- Jalankan sekali di Supabase SQL Editor setelah mengganti versi aplikasi.
-- PERINGATAN: policy anon di bawah membuka baca/tambah/edit/hapus kepada SIAPA PUN
-- yang mengetahui Project URL dan publishable key. Jangan simpan data sensitif.

begin;

-- Hapus policy autentikasi dari versi sebelumnya.
drop policy if exists "Users can read their own transactions" on public.transactions;
drop policy if exists "Users can insert their own transactions" on public.transactions;
drop policy if exists "Users can update their own transactions" on public.transactions;
drop policy if exists "Users can delete their own transactions" on public.transactions;
drop policy if exists "Public can read shared transactions" on public.transactions;
drop policy if exists "Public can insert shared transactions" on public.transactions;
drop policy if exists "Public can update shared transactions" on public.transactions;
drop policy if exists "Public can delete shared transactions" on public.transactions;

-- Hapus kolom pemilik karena semua perangkat memakai ruang data yang sama.
alter table public.transactions drop column if exists user_id cascade;

-- RLS tetap aktif, tetapi akses anonim dibuka sesuai pilihan tanpa-login.
alter table public.transactions enable row level security;

create policy "Public can read shared transactions"
on public.transactions for select
to anon, authenticated
using (true);

create policy "Public can insert shared transactions"
on public.transactions for insert
to anon, authenticated
with check (true);

create policy "Public can update shared transactions"
on public.transactions for update
to anon, authenticated
using (true)
with check (true);

create policy "Public can delete shared transactions"
on public.transactions for delete
to anon, authenticated
using (true);

-- Karena opsi auto-expose dimatikan saat pembuatan project, beri hak CRUD secara eksplisit.
grant usage on schema public to anon, authenticated;
revoke all on table public.transactions from anon, authenticated;
grant select, insert, update, delete on table public.transactions to anon, authenticated;

-- Pastikan perubahan tetap memicu sinkronisasi realtime.
alter table public.transactions replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'transactions'
  ) then
    alter publication supabase_realtime add table public.transactions;
  end if;
end;
$$;

commit;
