// Generic marketing copy for the public site. Replace with school-specific text before launch;
// school identity, contact details, classes, news and staff all come from the database.

export const pillars = [
  { icon: "GraduationCap", title: "Excellence in Education", text: "A rigorous curriculum aligned with the Nigerian national curriculum and WAEC/NECO requirements, with regular assessment and honest feedback." },
  { icon: "Cpu", title: "Technology-Driven Learning", text: "Online learning materials, digital result access and a school portal that keeps parents, students and teachers connected." },
  { icon: "Users", title: "Qualified Teachers", text: "Trained, registered teachers who are supported with continuous professional development and mentoring." },
  { icon: "Building2", title: "Modern Learning Environment", text: "Bright classrooms, equipped laboratories, a library and safe spaces for play and sport." },
  { icon: "Heart", title: "Student-Centered Education", text: "Small groups, individual attention and clear academic tracking so every child is seen and supported." },
  { icon: "ShieldCheck", title: "Safe & Disciplined", text: "A secure campus, clear conduct standards and pastoral care that builds character as well as grades." },
] as const;

export const facilities = [
  { title: "Science laboratories", text: "Physics, Chemistry and Biology labs for hands-on practicals." },
  { title: "ICT centre", text: "Computers for Computer Studies and digital research skills." },
  { title: "Library & reading room", text: "A quiet space with textbooks, past questions and reference material." },
  { title: "Sports & recreation", text: "Playing field and courts for athletics, football and inter-house events." },
  { title: "Medical bay", text: "First-aid care and a health officer on school days." },
  { title: "Secure campus", text: "Controlled access, supervised movement and trained security staff." },
];

export const achievements = [
  { title: "Examination success", text: "Consistent preparation for WAEC, NECO and Junior WAEC with mock examinations and revision clinics." },
  { title: "Competitions", text: "Participation in inter-school quizzes, debates, science fairs and sports competitions." },
  { title: "Arts & leadership", text: "Clubs, societies and prefect systems that develop confidence and service." },
];

export const testimonials = [
  { quote: "The school portal makes it easy for me to follow my child's progress every term. Communication is clear and timely.", name: "Parent", role: "JSS 2 parent" },
  { quote: "My teachers explain things patiently and the learning materials online help me revise at home.", name: "Student", role: "SS 1 student" },
  { quote: "A disciplined school with caring teachers. My son has grown in both confidence and results.", name: "Parent", role: "SS 2 parent" },
];

export const requirements = [
  "Completed online application form",
  "Birth certificate or declaration of age",
  "Last two terms' report cards from the previous school",
  "Two recent passport photographs",
  "Transfer or leaving certificate (for transfer students)",
  "Medical fitness and immunisation records",
];

export const process = [
  { title: "Apply online", text: "Complete the application form below. You receive a reference number immediately." },
  { title: "Review", text: "The admissions office reviews your application and may contact you by phone or email." },
  { title: "Assessment", text: "Shortlisted candidates sit a short entrance assessment and meet the school." },
  { title: "Offer & registration", text: "Successful candidates receive an offer, submit documents and complete registration." },
];

export const faqs = [
  { q: "How do I apply?", a: "Use the online application form on this page. Keep the reference number you receive; the school will contact the parent or guardian using the phone number or email supplied." },
  { q: "How do I check my child's result?", a: "Open Check Result, enter the Student ID, the PIN on your result-checking card, and choose the session and term. Cards are available from the school office." },
  { q: "What if my PIN does not work?", a: "Check that you typed it correctly and selected the right session and term. A card may be expired, disabled or may have reached its usage limit. Contact the school office for help." },
  { q: "Can I download or print the result?", a: "Yes. After checking, use Print or Download PDF. Every report card carries a QR code that confirms it is genuine." },
  { q: "How do students access learning materials?", a: "Students sign in to the Student Portal with the login given at registration and open Learning Materials for their class." },
  { q: "I forgot my password.", a: "Use 'Forgot password' on the login page if your account has an email address, or ask the school office to reset it." },
];
