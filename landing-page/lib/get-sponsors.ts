export interface Sponsor {
  __typename: 'User' | 'Organization';
  login: string;
  avatarUrl: string;
  websiteUrl?: string;
  name: string;
  tier: {
    monthlyPriceInDollars: number;
    name?: string;
  };
  isActive: boolean;
  isOneTimePayment: boolean;
}

const sponsors: Sponsor[] = [
  {
    __typename: 'Organization',
    login: 'mintlify',
    avatarUrl: 'https://avatars.githubusercontent.com/u/93011474',
    websiteUrl: 'https://mintlify.com',
    name: 'Mintlify',
    tier: { monthlyPriceInDollars: 1000 },
    isActive: true,
    isOneTimePayment: false,
  },
  {
    __typename: 'Organization',
    login: 'scalar',
    avatarUrl: 'https://avatars.githubusercontent.com/u/301879',
    websiteUrl: 'https://github.com/scalar/scalar',
    name: 'Scalar',
    tier: { monthlyPriceInDollars: 225 },
    isActive: true,
    isOneTimePayment: false,
  },
  {
    __typename: 'Organization',
    login: 'launchfast',
    avatarUrl: 'https://avatars.githubusercontent.com/u/159884869',
    websiteUrl: 'https://launchfa.st',
    name: 'LaunchFast',
    tier: { monthlyPriceInDollars: 225 },
    isActive: true,
    isOneTimePayment: false,
  },
  {
    __typename: 'Organization',
    login: 'orshot-hq',
    avatarUrl: 'https://avatars.githubusercontent.com/u/169961825',
    websiteUrl: 'https://orshot.com',
    name: 'Orshot',
    tier: { monthlyPriceInDollars: 128 },
    isActive: true,
    isOneTimePayment: false,
  },
];

export async function getSponsors(): Promise<Sponsor[]> {
  return sponsors;
}
