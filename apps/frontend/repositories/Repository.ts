import axios from 'axios';
import { env } from '../lib/env';

const repository = axios.create({
  baseURL: env.NEXT_PUBLIC_WP_ENDPOINT,
  headers: {
    'Content-Type': 'application/json'
  }
});

const Repository = (query: string, { variables }: Record<string, any> = {}) => {
  const body = {
    query,
    variables
  };
  return {
    getWp() {
      return repository.post('/', body);
    }
  };
};

export default Repository;
