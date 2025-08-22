'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

interface Question {
  id: number;
  text: string;
  options: string[];
  correctIdx: number;
}

interface Standing {
  userId: number;
  userName: string;
  score: number;
  newRating: number;
}

interface QuizState {
  currentQuestion: Question | null;
  questionIndex: number | null;
  timerSeconds: number;
  hasAnswered: boolean;
  selectedIdx: number | null;
  correctIdx: number | null;
  winnerUserId: number | null;
  isWaiting: boolean;
  showResults: boolean;
  standings: Standing[] | null;
  showStandings: boolean;
  questionEndTime?: number; // Server timestamp for synchronization
}

interface QuizPageProps {
  params: Promise<{ roomId: string }> | { roomId: string };
}

interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

export default function QuizPage({ params }: QuizPageProps) {
  // Fix: Handle params properly without experimental use() API
  const [roomId, setRoomId] = useState<string>('');
  const router = useRouter();
  const { data: session } = useSession();
  const [quizState, setQuizState] = useState<QuizState>({
    currentQuestion: null,
    questionIndex: null,
    timerSeconds: 10,
    hasAnswered: false,
    selectedIdx: null,
    correctIdx: null,
    winnerUserId: null,
    isWaiting: true,
    showResults: false,
    standings: null,
    showStandings: false,
    questionEndTime: undefined
  });
  const [error, setError] = useState<string | null>(null);
  const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null);
  const errorHandlerRef = useRef<((event: Event) => void) | null>(null);
  const closeHandlerRef = useRef<((event: CloseEvent) => void) | null>(null);

  // Handle params resolution
  useEffect(() => {
    const resolveParams = async () => {
      const resolvedParams = await Promise.resolve(params);
      setRoomId(resolvedParams.roomId);
    };
    resolveParams();
  }, [params]);

  // WebSocket message handler
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data);
      console.log('Quiz WebSocket message:', message);
      
      // Enhanced validation
      if (!message || typeof message !== 'object' || !message.type) {
        console.warn('Invalid message format:', message);
        return;
      }
      
      switch (message.type) {
        case 'connected':
          console.log('WebSocket connected in quiz');
          break;

        case 'nextQuestion':
          console.log('Next question received:', message.payload);
          if (message.payload) {
            const { questionIndex, question, startedAt, expiresAt } = message.payload;
            
            // Calculate initial time based on server timestamp for accurate synchronization
            const serverEndTime = new Date(expiresAt).getTime();
            const now = Date.now();
            const initialSeconds = Math.max(0, Math.ceil((serverEndTime - now) / 1000));
            
            console.log('Timer synchronization:', {
              serverEndTime: new Date(expiresAt).toISOString(),
              clientTime: new Date().toISOString(),
              calculatedSeconds: initialSeconds,
              timeDifference: serverEndTime - now
            });
            
            setQuizState({
              currentQuestion: question,
              questionIndex,
              timerSeconds: initialSeconds,
              hasAnswered: false,
              selectedIdx: null,
              correctIdx: null,
              winnerUserId: null,
              isWaiting: false,
              showResults: false,
              standings: null,
              showStandings: false,
              questionEndTime: serverEndTime // Store server end time for sync
            });
          }
          break;

        case 'endQuestion':
          console.log('End question received:', message.payload);
          if (message.payload) {
            const { correctIdx, winnerUserId } = message.payload;
            
            // Immediately show results and force timer to end
            setQuizState(prev => ({
              ...prev,
              correctIdx,
              winnerUserId,
              showResults: true,
              timerSeconds: 0 // Force timer to end immediately
            }));
          }
          break;

        case 'quizFinished':
          console.log('Quiz finished with standings:', message.payload);
          if (message.payload?.standings) {
            setQuizState(prev => ({
              ...prev,
              standings: message.payload.standings,
              showStandings: true
            }));
            // Auto-redirect after showing standings for 8 seconds
            setTimeout(() => {
              router.push(`/rooms/${roomId}`);
            }, 8000);
          } else {
            // Fallback if no standings provided
            router.push(`/rooms/${roomId}`);
          }
          break;

        case 'error':
          console.error('Quiz error:', message.payload?.message);
          setError(message.payload?.message || 'An error occurred');
          break;

        default:
          console.warn('Unknown quiz message type:', message.type);
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
      console.error('Raw message data:', event.data);
    }
  }, [roomId, router]);

  // Error handler
  const handleError = useCallback((event: Event) => {
    console.error('WebSocket error in quiz:', event);
    setError('Connection error occurred');
  }, []);

  // Close handler
  const handleClose = useCallback((event: CloseEvent) => {
    console.log('WebSocket closed in quiz:', event.code, event.reason);
    setError('Connection lost');
    setTimeout(() => {
      router.push(`/rooms/${roomId}`);
    }, 2000);
  }, [roomId, router]);

  // Handle WebSocket connection and messages
  useEffect(() => {
    if (!roomId) return;

    // Get the existing WebSocket connection from the window object
    const ws = (window as any).roomWebSocket as WebSocket | undefined;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not available or not connected');
      setError('Not connected to quiz room. Redirecting...');
      setTimeout(() => {
        router.push(`/rooms`);
      }, 2000);
      return;
    }

    console.log('Setting up WebSocket listeners for quiz');

    // Store handlers in refs for proper cleanup
    messageHandlerRef.current = handleMessage;
    errorHandlerRef.current = handleError;
    closeHandlerRef.current = handleClose;

    // Add event listeners
    ws.addEventListener('message', handleMessage);
    ws.addEventListener('error', handleError);
    ws.addEventListener('close', handleClose);

    return () => {
      // Clean up event listeners
      console.log('Cleaning up WebSocket listeners');
      if (messageHandlerRef.current) {
        ws.removeEventListener('message', messageHandlerRef.current);
      }
      if (errorHandlerRef.current) {
        ws.removeEventListener('error', errorHandlerRef.current);
      }
      if (closeHandlerRef.current) {
        ws.removeEventListener('close', closeHandlerRef.current);
      }
    };
  }, [roomId, router, handleMessage, handleError, handleClose]);

  // Synchronized timer effect - uses server timestamp for accurate timing
  useEffect(() => {
    if (!quizState.currentQuestion) return;

    const timer = setInterval(() => {
      setQuizState(prev => {
        let newSeconds: number;
        
        // Use server time if available for perfect synchronization
        if (prev.questionEndTime) {
          const now = Date.now();
          newSeconds = Math.max(0, Math.ceil((prev.questionEndTime - now) / 1000));
          
          // Debug logging for sync verification
          if (newSeconds <= 3) {
            console.log('Timer sync check:', {
              serverEndTime: new Date(prev.questionEndTime).toISOString(),
              currentTime: new Date(now).toISOString(),
              remainingMs: prev.questionEndTime - now,
              calculatedSeconds: newSeconds
            });
          }
        } else {
          // Fallback to countdown if no server time available
          newSeconds = Math.max(0, prev.timerSeconds - 1);
        }
        
        // Show results when we have correct answer AND time is up, or if already showing
        const shouldShowResults = (newSeconds === 0 && prev.correctIdx !== null) || prev.showResults;
        
        return {
          ...prev,
          timerSeconds: newSeconds,
          showResults: shouldShowResults
        };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [quizState.currentQuestion, quizState.questionEndTime]);

  // Handle answer submission
  const handleAnswer = useCallback(async (selectedIdx: number) => {
    if (quizState.hasAnswered || !quizState.currentQuestion || quizState.timerSeconds <= 0) {
      console.log('Cannot submit answer - conditions not met:', {
        hasAnswered: quizState.hasAnswered,
        hasQuestion: !!quizState.currentQuestion,
        timerSeconds: quizState.timerSeconds
      });
      return;
    }

    const ws = (window as any).roomWebSocket as WebSocket | undefined;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not available for answer submission');
      setError('Not connected to quiz room');
      return;
    }

    // Validate inputs before sending
    if (typeof selectedIdx !== 'number' || selectedIdx < 0 || selectedIdx > 3) {
      console.error('Invalid choice index:', selectedIdx);
      return;
    }

    if (typeof quizState.questionIndex !== 'number' || quizState.questionIndex < 0) {
      console.error('Invalid question index:', quizState.questionIndex);
      return;
    }

    try {
      const message = {
        type: 'submitAnswer',
        payload: {
          roomId,
          questionIndex: quizState.questionIndex,
          choiceIdx: selectedIdx
        }
      };

      console.log('Submitting answer:', message);
      ws.send(JSON.stringify(message));

      // Update local state - only mark as answered and store selection
      setQuizState(prev => ({
        ...prev,
        hasAnswered: true,
        selectedIdx
      }));

    } catch (err) {
      console.error('Failed to submit answer:', err);
      setError('Failed to submit answer');
    }
  }, [quizState.hasAnswered, quizState.currentQuestion, quizState.timerSeconds, quizState.questionIndex, roomId]);

  // Debug function to check WebSocket and timer state
  const debugWebSocketState = useCallback(() => {
    const ws = (window as any).roomWebSocket as WebSocket | undefined;
    console.log('WebSocket Debug:');
    console.log('- WebSocket exists:', !!ws);
    console.log('- WebSocket readyState:', ws?.readyState);
    console.log('- Room ID:', roomId);
    console.log('- Question Index:', quizState.questionIndex);
    console.log('- Has Answered:', quizState.hasAnswered);
    console.log('- Timer Seconds:', quizState.timerSeconds);
    console.log('- Show Results:', quizState.showResults);
    console.log('- Question End Time:', quizState.questionEndTime ? new Date(quizState.questionEndTime).toISOString() : 'Not set');
    console.log('- Current Time:', new Date().toISOString());
    if (quizState.questionEndTime) {
      console.log('- Time Difference:', quizState.questionEndTime - Date.now(), 'ms');
    }
  }, [roomId, quizState]);

  // Call debug function when there are issues (to be removed in production)
  useEffect(() => {
    if (error) {
      debugWebSocketState();
    }
  }, [error, debugWebSocketState]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded max-w-md text-center">
          <h3 className="font-bold mb-2">Error</h3>
          <p>{error}</p>
          <button 
            onClick={() => router.push('/rooms')}
            className="mt-4 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded"
          >
            Back to Rooms
          </button>
        </div>
      </div>
    );
  }

  if (quizState.isWaiting) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Quiz will start soon...</h2>
          <p className="text-gray-600">Please wait while we prepare your questions.</p>
          <div className="mt-4 animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      </div>
    );
  }

  if (!quizState.currentQuestion) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Waiting for questions...</h2>
          <div className="mt-4 animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <button 
            onClick={debugWebSocketState}
            className="mt-4 text-blue-600 hover:text-blue-800 text-sm"
          >
            Debug WebSocket
          </button>
        </div>
      </div>
    );
  }

  const user = session?.user as SessionUser | undefined;
  const currentUserId = user?.id ? parseInt(user.id) : null;

  // Show final standings screen
  if (quizState.showStandings && quizState.standings) {
    return (
      <div className="min-h-screen p-8 bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-xl p-8">
            {/* Header */}
            <div className="text-center mb-8">
              <h1 className="text-4xl font-bold text-gray-800 mb-2">🏆 Quiz Complete!</h1>
              <p className="text-lg text-gray-600">Final Standings & Ratings</p>
            </div>

            {/* Standings */}
            <div className="space-y-4 mb-8">
              {quizState.standings.map((standing, index) => {
                const isCurrentUser = standing.userId === currentUserId;
                const position = index + 1;
                let positionEmoji = '';
                let cardStyle = 'bg-gray-50 border border-gray-200';
                
                if (position === 1) {
                  positionEmoji = '🥇';
                  cardStyle = 'bg-gradient-to-r from-yellow-100 to-yellow-200 border-2 border-yellow-400';
                } else if (position === 2) {
                  positionEmoji = '🥈';
                  cardStyle = 'bg-gradient-to-r from-gray-100 to-gray-200 border-2 border-gray-400';
                } else if (position === 3) {
                  positionEmoji = '🥉';
                  cardStyle = 'bg-gradient-to-r from-orange-100 to-orange-200 border-2 border-orange-400';
                }

                if (isCurrentUser) {
                  cardStyle += ' ring-4 ring-blue-300';
                }

                return (
                  <div key={standing.userId} className={`p-6 rounded-lg ${cardStyle} transition-all duration-200`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="text-2xl font-bold text-gray-700">
                          {positionEmoji || `#${position}`}
                        </div>
                        <div>
                          <h3 className={`text-lg font-semibold ${isCurrentUser ? 'text-blue-700' : 'text-gray-800'}`}>
                            {standing.userName} {isCurrentUser && '(You)'}
                          </h3>
                          <p className="text-sm text-gray-600">
                            Score: {standing.score} points
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-xl font-bold ${isCurrentUser ? 'text-blue-700' : 'text-gray-700'}`}>
                          {standing.newRating}
                        </div>
                        <div className="text-sm text-gray-500">New Rating</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="text-center">
              <p className="text-sm text-gray-500 mb-4">
                Returning to lobby in a few seconds...
              </p>
              <button
                onClick={() => router.push(`/rooms/${roomId}`)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors duration-200"
              >
                Back to Lobby
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-800">
              Question {(quizState.questionIndex ?? 0) + 1}
            </h2>
            <div className={`text-lg font-semibold px-4 py-2 rounded-full ${
              quizState.timerSeconds > 5 
                ? 'bg-green-100 text-green-800' 
                : 'bg-red-100 text-red-800'
            }`}>
              Time: {quizState.timerSeconds}s
            </div>
          </div>

          {/* Question */}
          <div className="mb-8">
            <p className="text-xl text-gray-700 leading-relaxed">{quizState.currentQuestion.text}</p>
          </div>

          {/* Options */}
          <div className="space-y-4">
            {quizState.currentQuestion.options.map((option, idx) => {
              let buttonStyle = '';
              
              if (quizState.showResults) {
                // Show results when showResults is true (after endQuestion message or timer ends)
                if (idx === quizState.correctIdx) {
                  buttonStyle = 'bg-green-100 border-2 border-green-500 text-green-800';
                } else if (idx === quizState.selectedIdx && idx !== quizState.correctIdx) {
                  buttonStyle = 'bg-red-100 border-2 border-red-500 text-red-800';
                } else {
                  buttonStyle = 'bg-gray-100 border-2 border-gray-300 text-gray-600';
                }
              } else if (quizState.hasAnswered) {
                // After answering but before results are shown - highlight selected option
                if (idx === quizState.selectedIdx) {
                  buttonStyle = 'bg-blue-100 border-2 border-blue-500 text-blue-800';
                } else {
                  buttonStyle = 'bg-gray-100 border-2 border-gray-300 text-gray-600';
                }
              } else if (quizState.timerSeconds === 0) {
                // Time's up but no answer submitted
                buttonStyle = 'bg-gray-100 border-2 border-gray-300 text-gray-600';
              } else {
                // Interactive state
                buttonStyle = 'bg-white border-2 border-gray-200 hover:border-blue-500 hover:bg-blue-50 text-gray-800';
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleAnswer(idx)}
                  disabled={quizState.hasAnswered || quizState.timerSeconds === 0}
                  className={`w-full p-4 text-left rounded-lg transition-all duration-200 disabled:cursor-not-allowed ${buttonStyle}`}
                >
                  <span className="font-medium mr-3">{String.fromCharCode(65 + idx)}.</span>
                  {option}
                </button>
              );
            })}
          </div>

          {/* Status Messages */}
          {quizState.hasAnswered && !quizState.showResults && (
            <div className="mt-6 p-4 rounded-lg border-l-4 border-blue-500 bg-blue-50">
              <p className="text-blue-600 font-semibold flex items-center">
                <span className="mr-2">⏳</span>
                Answer submitted! Waiting for time to end...
              </p>
            </div>
          )}

          {/* Results - Only shown when showResults is true */}
          {quizState.showResults && (
            <div className="mt-6 p-4 rounded-lg border-l-4 border-blue-500 bg-blue-50">
              {quizState.correctIdx !== null && quizState.selectedIdx === quizState.correctIdx ? (
                <p className="text-green-600 font-semibold flex items-center">
                  <span className="mr-2">✅</span>
                  Correct! 
                  {quizState.winnerUserId === currentUserId && ' You got it first!'}
                </p>
              ) : quizState.selectedIdx !== null ? (
                <p className="text-red-600 font-semibold flex items-center">
                  <span className="mr-2">❌</span>
                  Incorrect. The correct answer was: {String.fromCharCode(65 + (quizState.correctIdx ?? 0))}. {quizState.currentQuestion.options[quizState.correctIdx ?? 0]}
                </p>
              ) : (
                <p className="text-gray-600 font-semibold flex items-center">
                  <span className="mr-2">⏰</span>
                  Time's up! The correct answer was: {String.fromCharCode(65 + (quizState.correctIdx ?? 0))}. {quizState.currentQuestion.options[quizState.correctIdx ?? 0]}
                </p>
              )}
              
              {quizState.winnerUserId && quizState.winnerUserId !== currentUserId && (
                <p className="text-gray-600 mt-2">Someone else got it first!</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}