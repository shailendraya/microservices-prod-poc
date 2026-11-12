import { useEffect, useState } from 'react';

interface User {
  id: string;
  name: string;
  email: string;
}

const API_URL = 'http://localhost:4000/graphql';

function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function executeGraphQL(query: string, variables?: object) {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const result = await response.json();

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    return result.data;
  }

  async function fetchUsers() {
    const data = await executeGraphQL(`
      query {
        users {
          id
          name
          email
        }
      }
    `);

    setUsers(data.users);
  }

  useEffect(() => {
    fetchUsers().catch(err => setError(err.message));
  }, []);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();

    setError('');
    setSuccess('');
    setLoading(true);

    try {
      await executeGraphQL(
        `
          mutation CreateUser($input: CreateUserInput!) {
            createUser(input: $input) {
              id
              name
              email
            }
          }
        `,
        {
          input: { name, email }
        }
      );

      setName('');
      setEmail('');

      await fetchUsers();

      setSuccess('User created successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: '30px', maxWidth: '700px' }}>
      <h1>E-commerce Application</h1>

      <h2>Create User</h2>

      <form onSubmit={handleCreateUser}>
        <div>
          <input
            placeholder="Name"
            value={name}
            onChange={e => setName(e.target.value)}
            required
          />
        </div>

        <br />

        <div>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </div>

        <br />

        <button type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create User'}
        </button>
      </form>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {success && <p style={{ color: 'green' }}>{success}</p>}

      <hr />

      <h2>Users ({users.length})</h2>

      {users.map(user => (
        <div key={user.id}>
          <p><strong>{user.name}</strong></p>
          <p>{user.email}</p>
          <hr />
        </div>
      ))}
    </div>
  );
}

export default App;