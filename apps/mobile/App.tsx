import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  StatusBar,
} from 'react-native';

export default function App() {
  const [remainingSessions, setRemainingSessions] = useState(8);
  const [totalSessions] = useState(10);

  const nextSession = {
    title: 'Birebir Klinik Reformer',
    trainer: 'Selin Aydın',
    time: 'Bugün, 15:00 - 16:00',
    room: 'Reformer Odası 1',
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Merhaba,</Text>
            <Text style={styles.userName}>Ayşe Demir</Text>
          </View>
          <View style={styles.studioBadge}>
            <Text style={styles.studioBadgeText}>Zen Pilates</Text>
          </View>
        </View>

        {/* Credit Card */}
        <View style={styles.creditCard}>
          <Text style={styles.creditTitle}>AKTİF PAKETİM</Text>
          <Text style={styles.packageName}>10 Seans Birebir Reformer</Text>
          <View style={styles.creditRow}>
            <Text style={styles.creditNumber}>{remainingSessions}</Text>
            <Text style={styles.creditTotal}>/ {totalSessions} Seans Kaldı</Text>
          </View>
          <Text style={styles.validityText}>Son Geçerlilik: 15 Kasım 2026</Text>
        </View>

        {/* Next Session Card */}
        <Text style={styles.sectionTitle}>Sıradaki Dersim</Text>
        <View style={styles.sessionCard}>
          <View style={styles.sessionHeader}>
            <Text style={styles.sessionTitle}>{nextSession.title}</Text>
            <View style={styles.confirmedBadge}>
              <Text style={styles.confirmedText}>Onaylandı</Text>
            </View>
          </View>
          <Text style={styles.sessionDetail}>⏱ {nextSession.time}</Text>
          <Text style={styles.sessionDetail}>👤 Eğitmen: {nextSession.trainer}</Text>
          <Text style={styles.sessionDetail}>📍 {nextSession.room}</Text>

          <TouchableOpacity style={styles.qrButton} activeOpacity={0.8}>
            <Text style={styles.qrButtonText}>Check-in QR Kodunu Göster</Text>
          </TouchableOpacity>
        </View>

        {/* Action Button */}
        <TouchableOpacity style={styles.bookButton} activeOpacity={0.8}>
          <Text style={styles.bookButtonText}>+ Yeni Seans Randevusu Al</Text>
        </TouchableOpacity>

        {/* Studio Cancellation Policy Notice */}
        <View style={styles.noticeBox}>
          <Text style={styles.noticeTitle}>📌 İptal Kuralı</Text>
          <Text style={styles.noticeText}>
            Ders saatine en geç 4 saat kalana kadar ücretsiz iptal edebilirsiniz. 4 saatten az kalan iptallerde seans kredisi düşülür.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090d16',
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 10,
  },
  greeting: {
    fontSize: 14,
    color: '#94a3b8',
  },
  userName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  studioBadge: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  studioBadgeText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
  },
  creditCard: {
    backgroundColor: '#0284c7',
    borderRadius: 20,
    padding: 22,
    marginBottom: 26,
    shadowColor: '#0284c7',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  creditTitle: {
    color: '#e0f2fe',
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: '700',
    marginBottom: 4,
  },
  packageName: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
  },
  creditRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  creditNumber: {
    color: '#ffffff',
    fontSize: 42,
    fontWeight: '800',
  },
  creditTotal: {
    color: '#bae6fd',
    fontSize: 16,
    marginLeft: 6,
    fontWeight: '600',
  },
  validityText: {
    color: '#e0f2fe',
    fontSize: 12,
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 12,
  },
  sessionCard: {
    backgroundColor: '#0f172a',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 20,
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sessionTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  confirmedBadge: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  confirmedText: {
    color: '#4ade80',
    fontSize: 11,
    fontWeight: '600',
  },
  sessionDetail: {
    color: '#cbd5e1',
    fontSize: 13,
    marginBottom: 4,
  },
  qrButton: {
    marginTop: 14,
    backgroundColor: '#1e293b',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  qrButtonText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '600',
  },
  bookButton: {
    backgroundColor: '#38bdf8',
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  bookButtonText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '700',
  },
  noticeBox: {
    backgroundColor: '#1e1b4b',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#3730a3',
  },
  noticeTitle: {
    color: '#c7d2fe',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  noticeText: {
    color: '#a5b4fc',
    fontSize: 11,
    lineHeight: 16,
  },
});
