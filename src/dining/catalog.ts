export type DiningBrand = { id: string; name: string; initials: string; color: string; match: RegExp; url: string; category: 'fast-food' | 'casual' | 'cafe' };
export const DINING_BRANDS: DiningBrand[] = [
  { id: 'wendys', name: "Wendy’s", initials: 'W', color: '#c93543', match: /\bwendy'?s\b/i, url: 'https://www.wendys.com/offers-coupons', category: 'fast-food' },
  { id: 'mcdonalds', name: 'McDonald’s', initials: 'M', color: '#b77b13', match: /\bmcdonald'?s\b/i, url: 'https://www.mcdonalds.com/us/en-us/deals.html', category: 'fast-food' },
  { id: 'tacobell', name: 'Taco Bell', initials: 'TB', color: '#8364c6', match: /\btaco bell\b/i, url: 'https://www.tacobell.com/offers-and-deals', category: 'fast-food' },
  { id: 'sonic', name: 'SONIC', initials: 'S', color: '#477ca4', match: /\bsonic\b/i, url: 'https://www.sonicdrivein.com/deals/', category: 'fast-food' },
  { id: 'arbys', name: 'Arby’s', initials: 'A', color: '#b83947', match: /\barby'?s\b/i, url: 'https://www.arbys.com/deals/', category: 'fast-food' },
  { id: 'chilis', name: 'Chili’s', initials: 'C', color: '#b34c3b', match: /\bchili'?s\b/i, url: 'https://www.chilis.com/specials', category: 'casual' },
  { id: 'applebees', name: 'Applebee’s', initials: 'A', color: '#6d874a', match: /\bapplebee'?s\b/i, url: 'https://www.applebees.com/en/specials', category: 'casual' },
  { id: 'burgerking', name: 'Burger King', initials: 'BK', color: '#ac623e', match: /\bburger king\b/i, url: 'https://www.bk.com/offers', category: 'fast-food' },
  { id: 'whataburger', name: 'Whataburger', initials: 'WB', color: '#c96e2e', match: /\bwhataburger\b/i, url: 'https://whataburger.com/', category: 'fast-food' },
  { id: 'popeyes', name: 'Popeyes', initials: 'P', color: '#c56c35', match: /\bpopeye'?s\b/i, url: 'https://www.popeyes.com/offers', category: 'fast-food' },
  { id: 'kfc', name: 'KFC', initials: 'K', color: '#bd3f48', match: /\bkfc\b|kentucky fried chicken/i, url: 'https://www.kfc.com/', category: 'fast-food' },
  { id: 'subway', name: 'Subway', initials: 'SW', color: '#64834c', match: /\bsubway\b/i, url: 'https://www.subway.com/', category: 'fast-food' },
  { id: 'jack', name: 'Jack in the Box', initials: 'J', color: '#b73f53', match: /\bjack in the box\b/i, url: 'https://www.jackinthebox.com/', category: 'fast-food' },
  { id: 'bww', name: 'Buffalo Wild Wings', initials: 'BW', color: '#9c7c20', match: /buffalo wild wings/i, url: 'https://www.buffalowildwings.com/', category: 'casual' },
  { id: 'panera', name: 'Panera Bread', initials: 'PB', color: '#718557', match: /\bpanera\b/i, url: 'https://www.panerabread.com/', category: 'cafe' },
];
export type DiningSource = { id: string; brand: string; url: string; parser: 'wendys' | 'mcdonalds' | 'headings' | 'contentful' | 'chilis'; label: string };
export const DINING_SOURCES: DiningSource[] = [
  ...DINING_BRANDS.slice(0, 7).map((brand): DiningSource => ({ id: brand.id, brand: brand.id, url: brand.url, label: `${brand.name} official offers`, parser: brand.id === 'wendys' ? 'wendys' : brand.id === 'mcdonalds' ? 'mcdonalds' : ['sonic', 'arbys'].includes(brand.id) ? 'contentful' : brand.id === 'chilis' ? 'chilis' : 'headings' })),
  { id: 'chilis-hours', brand: 'chilis', url: 'https://www.chilis.com/happy-hour', parser: 'headings', label: 'Chili’s happy hour' },
];
export const diningBrand = (name: string) => DINING_BRANDS.find((brand) => brand.match.test(name.replace(/[’‘]/g, "'")));
