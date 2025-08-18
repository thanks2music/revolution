import Repository from './Repository';

export const SITE_INFO_QUERY = `
  query GetSiteInfo {
    generalSettings {
      title
      description
      url
    }
  }
`;

export const getSiteInfo = async () => {
  const response = await Repository(SITE_INFO_QUERY).getWp();
  return response.data.data.generalSettings;
};
