import { Html, Head, Body, Container, Heading, Text, Section } from '@react-email/components'

/**
 * New sign-in warning email. Ported from `email_templates/new_sign_in.py`.
 * Marcus Cleaning branding; sender display name comes from EMAIL_FROM.
 * See: docs/migration/08-email-resend.md
 */

export interface NewSignInEmailProps {
  userEmail: string
  deviceInfo?: string | null
  ip?: string | null
  signedInAt?: string | null
}

export function NewSignInEmail({ userEmail, deviceInfo, ip, signedInAt }: NewSignInEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>New sign-in to your Marcus Cleaning account</Heading>
          <Text style={text}>
            We noticed a new sign-in to the account for {userEmail}. If this was you, no action is needed.
          </Text>
          <Section style={details}>
            <Text style={detailLine}>Device: {deviceInfo ?? 'Unknown'}</Text>
            <Text style={detailLine}>IP address: {ip ?? 'Unknown'}</Text>
            <Text style={detailLine}>Time: {signedInAt ?? 'Just now'}</Text>
          </Section>
          <Text style={muted}>
            If you don&apos;t recognise this activity, change your password and revoke active sessions immediately.
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
const details = { backgroundColor: '#f8fafc', borderRadius: '6px', padding: '12px 16px', margin: '16px 0' }
const detailLine = { fontSize: '13px', color: '#0f172a', margin: '4px 0' }
const muted = { fontSize: '12px', color: '#64748b', lineHeight: '18px' }

export default NewSignInEmail
