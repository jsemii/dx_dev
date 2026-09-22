export const mealMedicationCareMock = {
  enabled: false,
  sections: {
    meal: {
      title: '식사 시간',
      enabled: true,
      reminders: [
        { id: 'breakfast', name: '아침 식사', time: '08:30', enabled: true },
        { id: 'lunch', name: '점심 식사', time: '13:30', enabled: true },
        { id: 'dinner', name: '저녁 식사', time: '19:30', enabled: true },
      ],
    },
    medication: {
      title: '약 복용 시간',
      enabled: true,
      reminders: [
        { id: 'evening-medication', name: '저녁 약', time: '08:30', enabled: true },
      ],
    },
  },
};
