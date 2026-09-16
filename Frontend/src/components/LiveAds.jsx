import { Link } from 'react-router-dom';
import { ArrowRight, Radio } from 'lucide-react';

function LiveAds({ ads = [] }) {
  if (!ads.length) return null;
  return <section className="live-ads"><div className="section-heading"><h2><Radio size={17} /> Live Ads</h2><span>Active store announcements</span></div><div className="live-ads__track">{ads.slice(0, 4).map((ad) => <article className="live-ad" key={ad._id}><div>{ad.image && <img src={ad.image} alt="" />}<strong>{ad.title}</strong><p>{ad.message}</p><Link to={ad.link || '/shop'}>Explore <ArrowRight size={13} /></Link></div></article>)}</div></section>;
}

export default LiveAds;
