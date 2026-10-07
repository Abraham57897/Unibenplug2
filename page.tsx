import { notFound } from 'next/navigation';
import Feed from '@/components/Feed';
import { supabase } from '@/lib/supabase';
import type { Campus, Post } from '@/lib/types';

export const revalidate = 30;

export default async function CampusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data: campus } = await supabase.from('campuses').select('*').eq('slug', slug).eq('is_active', true).maybeSingle();
  if (!campus) notFound();
  const { data: posts } = await supabase.from('feed_posts').select('*').eq('campus_id', campus.id)
    .eq('status', 'approved').gt('expires_at', new Date().toISOString()).limit(300);
  return <Feed campus={campus as Campus} initial={(posts as Post[]) ?? []} />;
}
