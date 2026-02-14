import Hero from '@/components/home/Hero';
import FeaturedProducts from '@/components/home/FeaturedProducts';
import CategoryGrid from '@/components/home/CategoryGrid';
import PromoBar from '@/components/home/PromoBar';

export default function Home() {
  return (
    <>
      <Hero />
      <FeaturedProducts />
      <CategoryGrid />
      <PromoBar />
    </>
  );
}
