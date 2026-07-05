import { useState } from 'react';

// Channel / subreddit avatar with a graceful fallback: if there's no image, or
// the image fails to load (YouTube avatar URLs sometimes 404 or get blocked),
// show the first-letter monogram instead of a broken image. `referrerPolicy`
// is no-referrer because some googleusercontent avatars refuse a local Referer.
export function Avatar({ src, name, imgClass, letterClass }) {
  const [failed, setFailed] = useState(false);
  const letter = (name || '?').replace(/^r\//, '').charAt(0).toUpperCase();

  if (src && !failed) {
    return (
      <img
        className={imgClass}
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return <span className={letterClass}>{letter}</span>;
}
