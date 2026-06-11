import { Html, Head, Body, Container, Heading, Text, Section } from '@react-email/components'

/**
 * Login OTP email. Ported from `email_templates/otp_template.py`.
 * Marcus Cleaning branding; sender display name comes from EMAIL_FROM.
 * See: docs/migration/08-email-resend.md
 */

export interface OtpEmailProps {
  otp: string
  userEmail: string
}

export function OtpEmail({ otp, userEmail }: OtpEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Your Marcus Cleaning login code</Heading>
          <Text style={text}>Use the code below to sign in as {userEmail}.</Text>
          <Section style={codeBox}>
            <Text style={code}>{otp}</Text>
          </Section>
          <Text style={muted}>
            This code expires shortly. If you didn&apos;t request it, you can safely ignore this email.
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
const codeBox = { textAlign: 'center' as const, margin: '24px 0' }
const code = { fontSize: '32px', letterSpacing: '8px', fontWeight: 700 as const, color: '#0f172a' }
const muted = { fontSize: '12px', color: '#64748b', lineHeight: '18px' }

export default OtpEmail
