import { Html, Head, Body, Container, Heading, Text } from '@react-email/components'

/**
 * Access revoked email. Ported from `email_templates/revoking_template.py`.
 * Marcus Cleaning branding; sender display name comes from EMAIL_FROM.
 * See: docs/migration/08-email-resend.md
 */

export interface RevokeEmailProps {
  userEmail: string
  reason?: string | null
}

export function RevokeEmail({ userEmail, reason }: RevokeEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Your Marcus Cleaning access has been revoked</Heading>
          <Text style={text}>
            Access for the account {userEmail} has been revoked.
            {reason ? ` Reason: ${reason}.` : ''}
          </Text>
          <Text style={muted}>
            If you believe this was a mistake, please contact the Marcus Cleaning support team.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const body = { backgroundColor: '#f4f6f8', fontFamily: 'Arial, sans-serif' }
const container = { backgroundColor: '#ffffff', padding: '32px', borderRadius: '8px', maxWidth: '480px' }
const heading = { fontSize: '20px', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#334155', lineHeight: '22px' }
const muted = { fontSize: '12px', color: '#64748b', lineHeight: '18px' }

export default RevokeEmail
