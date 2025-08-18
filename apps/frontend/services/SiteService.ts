import * as SiteRepository from '../repositories/SiteRepository';

export default class SiteService {
  static async getSiteInfo() {
    const data = await SiteRepository.getSiteInfo();
    return {
      title: data.title || 'Revolution',
      description: data.description,
      url: data.url
    };
  }
}
