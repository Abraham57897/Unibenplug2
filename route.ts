import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// Validate the user's session, optionally moderate the image, then store it in the existing public Supabase bucket.
export async function POST(req: Request) {
  try {
    const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return NextResponse.json({ error: 'Login required' }, { status: 401 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) {
      return NextResponse.json({ error: 'Supabase image storage is not configured on the server.' }, { status: 503 });
    }

    const anon = createClient(url, anonKey);
    const { data: authData, error: authError } = await anon.auth.getUser(token);
    if (authError || !authData.user) return NextResponse.json({ error: 'Your session has expired. Log in again.' }, { status: 401 });

    const file = (await req.formData()).get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Choose an image to upload.' }, { status: 400 });
    const extension = IMAGE_TYPES[file.type.toLowerCase()];
    if (!extension) return NextResponse.json({ error: 'Use a JPEG, PNG, WebP, or GIF image.' }, { status: 415 });
    if (file.size <= 0) return NextResponse.json({ error: 'The selected image is empty.' }, { status: 400 });
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'Image must be under 5MB.' }, { status: 413 });

    if (process.env.SIGHTENGINE_USER && process.env.SIGHTENGINE_SECRET) {
      const body = new FormData();
      body.append('media', file);
      body.append('models', 'nudity-2.1');
      body.append('api_user', process.env.SIGHTENGINE_USER);
      body.append('api_secret', process.env.SIGHTENGINE_SECRET);
      try {
        const response = await fetch('https://api.sightengine.com/1.0/check.json', { method: 'POST', body });
        if (!response.ok) return NextResponse.json({ error: 'Image check failed. Try again.' }, { status: 502 });
        const result = await response.json();
        const nudity = result?.nudity;
        if (!nudity) return NextResponse.json({ error: 'Image check failed. Try again.' }, { status: 502 });
        if (nudity.sexual_activity > 0.5 || nudity.sexual_display > 0.5 || nudity.erotica > 0.5) {
          return NextResponse.json({ error: 'This image breaks the Community Policy.' }, { status: 422 });
        }
      } catch {
        return NextResponse.json({ error: 'Image check failed. Try again.' }, { status: 502 });
      }
    }

    const admin = createClient(url, serviceKey);
    const path = `${authData.user.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await admin.storage.from('post-images').upload(path, file, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: false,
    });
    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });
    const publicUrl = admin.storage.from('post-images').getPublicUrl(path).data.publicUrl;
    if (!publicUrl) return NextResponse.json({ error: 'Image uploaded, but its public URL could not be created.' }, { status: 500 });
    return NextResponse.json({ url: publicUrl });
  } catch {
    return NextResponse.json({ error: 'Image upload failed. Check the image and try again.' }, { status: 500 });
  }
}
